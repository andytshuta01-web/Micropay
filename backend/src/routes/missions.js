import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDb, saveDb } from '../store.js';
import { DEMO_PROVIDER_ID, PROVIDERS, getResource, getProvider } from '../providers.js';
import { evaluatePolicy } from '../policyEngine.js';
import { getPayoutStatus, sendPayout } from '../paypal.js';
import { runAgentLoop } from '../agent.js';
import { config } from '../config.js';

export const missionsRouter = Router();

function parseNumericInput(value, fallback) {
  const candidate = value ?? fallback;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return NaN;
  if (typeof candidate === 'string' && !candidate.trim()) return NaN;
  return Number(candidate);
}

function getTransactionStatusFromPayPal(status) {
  const normalized = String(status || 'PENDING').toUpperCase();
  if (normalized === 'SUCCESS') return 'executed';
  if (['DENIED', 'CANCELED', 'FAILED'].includes(normalized)) return 'failed';
  return 'processing';
}

// --- Création d'une mission + sa politique de dépense ---
missionsRouter.post('/', (req, res) => {
  const { objective, budgetTotal, autoApproveThreshold, allowedProviders, maxPaymentsPerMinute, minConfidence } =
    req.body || {};

  if (typeof objective !== 'string' || !objective.trim() || objective.length > 1000) {
    return res.status(400).json({ error: 'objective doit contenir de 1 à 1 000 caractères.' });
  }

  const parsedBudget = parseNumericInput(budgetTotal);
  const parsedAutoApproveThreshold = parseNumericInput(autoApproveThreshold, 0.75);
  const parsedMaxPaymentsPerMinute = parseNumericInput(maxPaymentsPerMinute, 3);
  const parsedMinConfidence = parseNumericInput(minConfidence, 0.5);
  const providerIds = allowedProviders ?? [];
  const knownProviderIds = new Set(PROVIDERS.map((provider) => provider.id));

  if (!Number.isFinite(parsedBudget) || parsedBudget <= 0 || parsedBudget > 100_000) {
    return res.status(400).json({ error: 'budgetTotal doit être compris entre 0,01 et 100 000 USD.' });
  }
  if (!Number.isFinite(parsedAutoApproveThreshold) ||
    parsedAutoApproveThreshold < 0 || parsedAutoApproveThreshold > parsedBudget) {
    return res.status(400).json({ error: 'autoApproveThreshold doit être compris entre 0 et le budget total.' });
  }
  if (!Number.isInteger(parsedMaxPaymentsPerMinute) ||
    parsedMaxPaymentsPerMinute < 1 || parsedMaxPaymentsPerMinute > 60) {
    return res.status(400).json({ error: 'maxPaymentsPerMinute doit être un entier compris entre 1 et 60.' });
  }
  if (!Number.isFinite(parsedMinConfidence) || parsedMinConfidence < 0 || parsedMinConfidence > 1) {
    return res.status(400).json({ error: 'minConfidence doit être compris entre 0 et 1.' });
  }
  if (!Array.isArray(providerIds) || providerIds.length > knownProviderIds.size ||
    providerIds.some((providerId) => typeof providerId !== 'string' || !knownProviderIds.has(providerId))) {
    return res.status(400).json({ error: 'allowedProviders contient un fournisseur invalide.' });
  }

  const db = getDb();
  const id = nanoid(10);

  db.missions[id] = {
    id,
    objective: objective.trim(),
    budgetTotal: parsedBudget,
    budgetRemaining: parsedBudget,
    status: 'created',
    createdAt: new Date().toISOString(),
  };

  db.policies[id] = {
    missionId: id,
    autoApproveThreshold: parsedAutoApproveThreshold,
    allowedProviders: [...new Set(providerIds)], // vide = toutes autorisées
    maxPaymentsPerMinute: parsedMaxPaymentsPerMinute,
    minConfidence: parsedMinConfidence,
  };

  db.logs[id] = [];

  saveDb();
  res.status(201).json({ mission: db.missions[id], policy: db.policies[id] });
});

missionsRouter.get('/', (req, res) => {
  const db = getDb();
  res.json(
    Object.values(db.missions)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  );
});

missionsRouter.get('/overview', (req, res) => {
  const db = getDb();
  const missions = Object.values(db.missions)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((mission) => ({
      ...mission,
      policy: db.policies[mission.id],
      logs: db.logs[mission.id] || [],
      requests: Object.values(db.requests).filter((request) => request.missionId === mission.id),
    }));

  res.json({ missions });
});

missionsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const mission = db.missions[req.params.id];
  if (!mission) return res.status(404).json({ error: 'Mission introuvable.' });

  const requests = Object.values(db.requests).filter((r) => r.missionId === mission.id);
  res.json({
    mission,
    policy: db.policies[mission.id],
    logs: db.logs[mission.id] || [],
    requests,
  });
});

// --- Lance la boucle de l'agent sur une mission ---
missionsRouter.post('/:id/run', (req, res) => {
  const db = getDb();
  const mission = db.missions[req.params.id];
  const policy = db.policies[req.params.id];
  if (!mission || !policy) {
    return res.status(404).json({ error: 'Mission introuvable.' });
  }

  mission.status = 'running';
  saveDb();

  const log = (entry) => {
    db.logs[mission.id] = db.logs[mission.id] || [];
    db.logs[mission.id].push({ id: nanoid(8), missionId: mission.id, ts: new Date().toISOString(), ...entry });
    saveDb();
  };

  const recentPayments = () =>
    Object.values(db.requests)
      .filter((r) => r.missionId === mission.id && r.transaction?.status === 'executed')
      .map((r) => ({ ts: new Date(r.transaction.executedAt).getTime() }));

  // Intercepte chaque demande de paiement de l'agent : c'est le cœur du système.
  const onToolCall = async (name, args) => {
    if (name !== 'demander_paiement') return { error: 'outil non supporté ici' };

    const resource = getResource(args.resource_id);
    if (!resource) return { error: 'ressource introuvable' };
    const provider = getProvider(resource.providerId);

    const reqId = nanoid(10);
    const request = {
      id: reqId,
      missionId: mission.id,
      resourceId: resource.id,
      resourceTitle: resource.title,
      providerId: resource.providerId,
      providerName: provider?.name,
      amount: resource.price,
      isDemoProduct: Boolean(resource.isDemoProduct),
      externalProductId: resource.externalProductId ?? null,
      raison: args.raison,
      confiance: args.confiance,
      createdAt: new Date().toISOString(),
      decision: null,
      transaction: null,
    };

    let decision = evaluatePolicy(policy, {
      providerId: resource.providerId,
      amount: resource.price,
      confidence: args.confiance,
      budgetRemaining: mission.budgetRemaining,
      recentPayments: recentPayments(),
    });

    if (resource.isDemoProduct && decision.verdict === 'AUTORISER') {
      decision = {
        verdict: 'ESCALADER',
        rule: 'demo_validation_requise',
        detail: 'Une validation humaine est requise. L’approbation créera une simulation DummyJSON, sans paiement ni livraison.',
      };
    }

    request.decision = decision;
    db.requests[reqId] = request;

    log({
      etape: 'decision_politique',
      raisonnement_agent: `Verdict : ${decision.verdict} (${decision.rule}) — ${decision.detail}`,
    });

    if (decision.verdict === 'REFUSER') {
      request.transaction = { status: 'refused', reason: decision.detail };
      saveDb();
      return { ok: false, verdict: decision.verdict, detail: decision.detail };
    }

    if (decision.verdict === 'ESCALADER') {
      request.transaction = { status: 'pending_approval' };
      saveDb();
      return {
        ok: false,
        verdict: decision.verdict,
        detail: decision.detail,
        info: "La demande est en attente de validation humaine dans le dashboard.",
      };
    }

    // AUTORISER → exécution réelle via PayPal
    try {
      const payout = await sendPayout({
        amount: resource.price,
        receiverEmail: provider?.sandboxReceiverEmail,
        note: `MicroPay — ${resource.title}`,
        senderBatchId: `micropay_${reqId}`,
      });
      const transactionStatus = getTransactionStatusFromPayPal(payout.status);
      request.transaction = {
        status: transactionStatus,
        paypalReference: payout.paypalReference,
        paypalStatus: payout.status,
        submittedAt: new Date().toISOString(),
        budgetCommitted: transactionStatus === 'processing',
        ...(transactionStatus === 'executed' ? { executedAt: new Date().toISOString() } : {}),
        ...(transactionStatus === 'failed' ? { reason: `PayPal a retourné le statut ${payout.status}.` } : {}),
      };
      if (transactionStatus !== 'failed') {
        mission.budgetRemaining = Number((mission.budgetRemaining - resource.price).toFixed(2));
      }
      saveDb();
      log({
        etape: transactionStatus === 'executed'
          ? 'paiement_execute'
          : transactionStatus === 'processing'
            ? 'paiement_sandbox_en_cours'
            : 'paiement_echec',
        raisonnement_agent: transactionStatus === 'executed'
          ? `Paiement Sandbox confirmé : ${resource.price.toFixed(2)} USD → ${provider?.name} (réf. ${payout.paypalReference}).`
          : transactionStatus === 'processing'
            ? `Paiement Sandbox soumis : ${resource.price.toFixed(2)} USD → ${provider?.name}; statut PayPal ${payout.status} (réf. ${payout.paypalReference}).`
            : `PayPal a refusé le virement Sandbox (statut ${payout.status}).`,
      });
      return {
        ok: transactionStatus === 'executed',
        verdict: decision.verdict,
        paypalReference: payout.paypalReference,
        paypalStatus: payout.status,
      };
    } catch (err) {
      request.transaction = { status: 'failed', error: String(err.message || err) };
      saveDb();
      log({ etape: 'paiement_echec', raisonnement_agent: `Échec du paiement PayPal : ${err.message}` });
      return { ok: false, verdict: 'ERREUR_PAIEMENT', detail: String(err.message || err) };
    }
  };

  res.status(202).json({ mission });
  runAgentLoop({
    mission,
    policy,
    getBudgetRemaining: () => mission.budgetRemaining,
    onToolCall,
    onLog: log,
  })
    .then(() => {
      mission.status = 'completed';
    })
    .catch((err) => {
      mission.status = 'error';
      log({ etape: 'erreur', raisonnement_agent: String(err.message || err) });
    })
    .finally(saveDb);
});

// --- Validation manuelle d'une demande en attente ---
missionsRouter.post('/requests/:requestId/approve', async (req, res) => {
  const db = getDb();
  const request = db.requests[req.params.requestId];
  const mission = request && db.missions[request.missionId];
  if (!request || !mission) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  if (request.transaction?.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Cette demande ne peut plus être approuvée.' });
  }
  const reservedBudget = Object.values(db.requests)
    .filter((entry) => entry.missionId === mission.id && entry.transaction?.budgetReserved)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  if (request.amount > mission.budgetRemaining - reservedBudget) {
    request.transaction = { status: 'refused', reason: 'Budget insuffisant au moment de la validation.' };
    saveDb();
    return res.status(400).json({ error: 'Le budget restant ne permet plus d’approuver cette demande.' });
  }

  const provider = getProvider(request.providerId);
  const isDemoProduct = request.isDemoProduct && request.providerId === DEMO_PROVIDER_ID;
  if (isDemoProduct && config.paypal.mode !== 'sandbox') {
    return res.status(503).json({ error: 'Les articles de démonstration exigent PAYPAL_MODE=sandbox.' });
  }

  const receiverEmail = isDemoProduct
    ? config.paypal.sandboxReceiverEmail
    : provider?.sandboxReceiverEmail;
  if (!receiverEmail) {
    const message = isDemoProduct
      ? 'Configurez PAYPAL_SANDBOX_RECEIVER_EMAIL avec l’adresse de votre compte marchand Sandbox.'
      : 'Adresse e-mail du destinataire PayPal manquante.';
    return res.status(503).json({ error: message });
  }

  request.transaction = {
    status: 'processing',
    submittedAt: new Date().toISOString(),
    budgetReserved: true,
  };
  saveDb();

  try {
    const payout = await sendPayout({
      amount: request.amount,
      receiverEmail,
      note: `MicroPay (validation manuelle) — ${request.resourceTitle}`,
      senderBatchId: `micropay_${request.id}`,
    });
    const paypalStatus = String(payout.status || 'PENDING').toUpperCase();
    const transactionStatus = getTransactionStatusFromPayPal(paypalStatus);
    request.transaction = {
      status: transactionStatus,
      paypalReference: payout.paypalReference,
      paypalStatus,
      submittedAt: request.transaction.submittedAt,
      budgetReserved: false,
      budgetCommitted: transactionStatus === 'processing',
      approvedManually: true,
      ...(transactionStatus === 'executed' ? { executedAt: new Date().toISOString() } : {}),
      ...(transactionStatus === 'failed' ? { reason: `PayPal a retourné le statut ${paypalStatus}.` } : {}),
    };
    if (transactionStatus !== 'failed') {
      mission.budgetRemaining = Number((mission.budgetRemaining - request.amount).toFixed(2));
    }

    db.logs[mission.id] = db.logs[mission.id] || [];
    db.logs[mission.id].push({
      id: nanoid(8),
      missionId: mission.id,
      ts: new Date().toISOString(),
      etape: transactionStatus === 'executed'
        ? 'validation_manuelle_approuvee'
        : transactionStatus === 'processing'
          ? 'paiement_sandbox_en_cours'
          : 'paiement_echec',
      raisonnement_agent: transactionStatus === 'executed'
        ? `Paiement Sandbox de ${request.amount.toFixed(2)} USD confirmé pour ${request.providerName} (réf. ${payout.paypalReference}).`
        : transactionStatus === 'processing'
          ? `Paiement Sandbox soumis pour ${request.amount.toFixed(2)} USD; statut PayPal : ${paypalStatus} (réf. ${payout.paypalReference}).`
          : `Paiement Sandbox refusé par PayPal (statut ${paypalStatus}).`,
    });

    saveDb();
    res.json({ request, mission });
  } catch (err) {
    request.transaction = { status: 'failed', error: String(err.message || err) };
    db.logs[mission.id] = db.logs[mission.id] || [];
    db.logs[mission.id].push({
      id: nanoid(8),
      missionId: mission.id,
      ts: new Date().toISOString(),
      etape: 'paiement_echec',
      raisonnement_agent: `Échec du paiement PayPal Sandbox : ${err.message || err}`,
    });
    saveDb();
    res.status(502).json({ error: 'PayPal Sandbox n’a pas confirmé le virement. Vérifiez la configuration et le compte destinataire.' });
  }
});

missionsRouter.get('/requests/:requestId/status', async (req, res) => {
  const db = getDb();
  const request = db.requests[req.params.requestId];
  const mission = request && db.missions[request.missionId];
  if (!request || !mission) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  if (request.transaction?.status !== 'processing') {
    return res.json({ request, mission });
  }
  if (!request.transaction.paypalReference) {
    return res.status(409).json({ error: 'Référence PayPal indisponible pour vérifier le virement.' });
  }

  try {
    const payout = await getPayoutStatus(request.transaction.paypalReference);
    const transactionStatus = getTransactionStatusFromPayPal(payout.status);
    request.transaction.paypalStatus = payout.status;
    request.transaction.lastStatusCheckedAt = new Date().toISOString();

    if (transactionStatus === 'executed') {
      request.transaction.status = 'executed';
      request.transaction.executedAt = new Date().toISOString();
      request.transaction.budgetCommitted = false;
    } else if (transactionStatus === 'failed') {
      request.transaction.status = 'failed';
      request.transaction.reason = `PayPal a retourné le statut ${payout.status}.`;
      if (request.transaction.budgetCommitted) {
        mission.budgetRemaining = Math.min(
          Number(mission.budgetTotal),
          Number((mission.budgetRemaining + request.amount).toFixed(2)),
        );
      }
      request.transaction.budgetCommitted = false;
    }

    if (transactionStatus !== 'processing') {
      db.logs[mission.id] = db.logs[mission.id] || [];
      db.logs[mission.id].push({
        id: nanoid(8),
        missionId: mission.id,
        ts: new Date().toISOString(),
        etape: transactionStatus === 'executed' ? 'paiement_execute' : 'paiement_echec',
        raisonnement_agent: transactionStatus === 'executed'
          ? `Paiement Sandbox confirmé par PayPal (réf. ${payout.paypalReference}).`
          : `Paiement Sandbox non exécuté par PayPal (statut ${payout.status}); budget libéré.`,
      });
    }

    saveDb();
    return res.json({ request, mission });
  } catch (error) {
    res.status(502).json({ error: 'Impossible de vérifier le statut PayPal Sandbox pour le moment.' });
  }
});

missionsRouter.post('/requests/:requestId/reject', (req, res) => {
  const db = getDb();
  const request = db.requests[req.params.requestId];
  const mission = request && db.missions[request.missionId];
  if (!request || !mission) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  if (request.transaction?.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Cette demande ne peut plus être refusée.' });
  }

  request.transaction = { status: 'rejected', rejectedAt: new Date().toISOString() };

  db.logs[request.missionId] = db.logs[request.missionId] || [];
  db.logs[request.missionId].push({
    id: nanoid(8),
    missionId: request.missionId,
    ts: new Date().toISOString(),
    etape: 'validation_manuelle_refusee',
    raisonnement_agent: `Paiement de ${request.amount.toFixed(2)} USD refusé manuellement pour ${request.providerName}.`,
  });

  saveDb();
  res.json({ request });
});
