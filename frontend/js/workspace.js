import {
  approveRequest,
  createMission,
  getMission,
  getOverview,
  listProviders,
  refreshPayoutStatus,
  rejectRequest,
  runMission,
} from './api.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[char]);
const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;
const dateTime = (date) => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Date inconnue' : parsed.toLocaleString('fr-FR');
};
const STATUS_LABELS = {
  created: 'Créée',
  running: 'Agent actif',
  completed: 'Terminée',
  error: 'Erreur',
  pending_approval: 'À valider',
  processing: 'En cours chez PayPal',
  executed: 'Payé',
  refused: 'Refusé',
  rejected: 'Refusé',
  failed: 'Échec',
  simulated: 'Simulation effectuée',
};
const RULE_LABELS = {
  budget_insuffisant: 'Budget insuffisant',
  fournisseur_non_autorise: 'Fournisseur non autorisé',
  frequence_excessive: 'Fréquence excessive',
  justification_insuffisante: 'Confiance insuffisante',
  seuil_depasse: 'Seuil d’auto-approbation dépassé',
  toutes_regles_respectees: 'Toutes les règles sont respectées',
};

let missions = [];
let requests = [];
let currentView = 'dashboard';
let refreshTimer;
let lastOverviewSnapshot = '';
let lastConversationSnapshot = '';
let lastPayoutStatusRefreshAt = 0;
let activeConversationMissionId = null;
let flowPeriod = 7;

function showError(message) {
  const element = $('#workspaceError');
  element.textContent = message;
  element.hidden = false;
}

function clearError() {
  const element = $('#workspaceError');
  element.textContent = '';
  element.hidden = true;
}

function setView(view) {
  // Utilise la navigation globale (définie dans le HTML, fonctionne sans module ES)
  if (typeof window.setView === 'function' && window.setView !== setView) {
    window.setView(view);
    currentView = view;
    return;
  }
  currentView = view;
  const views = {
    dashboard: ['dashboardView', "Vue d'ensemble"],
    create: ['createView', 'Nouvelle mission'],
    invoices: ['invoicesView', 'Reçus'],
    purchases: ['purchasesView', 'Paiements'],
    settings: ['settingsView', 'Paramètres'],
    help: ['helpView', "Centre d'aide"],
  };
  const selected = views[view] || views.dashboard;
  const resolvedView = views[view] ? view : 'dashboard';
  Object.keys(views).forEach((name) => {
    const el = document.getElementById(views[name][0]);
    if (el) el.hidden = name !== resolvedView;
  });
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = selected[1];
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === resolvedView);
  });
}

function getTransactionStatus(request) {
  return request.transaction?.status || 'pending';
}

function statusPill(status) {
  return `<span class="status-pill status-pill--${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function requestCard(request, interactive = true, idPrefix = 'request') {
  const mission = missions.find((item) => item.id === request.missionId);
  const status = getTransactionStatus(request);
  const pending = status === 'pending_approval';
  return `
    <article class="request-card${pending ? ' request-card--pending' : ''}" id="${escapeHtml(idPrefix)}-${escapeHtml(request.id)}">
      <div class="request-card__main">
        <h3>${escapeHtml(request.resourceTitle || 'Achat')}</h3>
        <p>${escapeHtml(request.providerName || 'Fournisseur')} · ${escapeHtml(mission?.objective || 'Mission')} · ${dateTime(request.createdAt)}</p>
        ${request.raison ? `<p class="request-card__reason">${escapeHtml(request.raison)}</p>` : ''}
        ${request.decision ? `<p class="request-card__detail">${escapeHtml(RULE_LABELS[request.decision.rule] || request.decision.rule)} — ${escapeHtml(request.decision.detail)}</p>` : ''}
        ${request.isDemoProduct ? '<p class="request-card__detail">Article fictif : aucun produit ne sera livré. Le virement Sandbox ne part qu’après validation humaine.</p>' : ''}
        ${request.transaction?.paypalReference ? `<p>Référence PayPal : ${escapeHtml(request.transaction.paypalReference)}</p>` : ''}
        ${request.transaction?.paypalStatus ? `<p class="request-card__detail">Statut PayPal : ${escapeHtml(request.transaction.paypalStatus)}</p>` : ''}
        ${request.transaction?.demoOrderReference ? `<p>Référence de simulation : ${escapeHtml(request.transaction.demoOrderReference)}</p>` : ''}
        ${request.transaction?.reason ? `<p class="request-card__detail">${escapeHtml(request.transaction.reason)}</p>` : ''}
      </div>
      <div class="request-card__actions">
        <span class="request-card__amount">${money(request.amount)}</span>
        ${statusPill(status)}
        ${interactive && pending ? `
          <button class="small-button" type="button" data-reject="${escapeHtml(request.id)}">Refuser</button>
          <button class="small-button small-button--approve" type="button" data-approve="${escapeHtml(request.id)}">${request.isDemoProduct ? 'Valider la simulation' : 'Approuver'}</button>
        ` : ''}
      </div>
    </article>
  `;
}

function renderSidebar() {
  const sortedRequests = [...requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('#purchaseCount').textContent = sortedRequests.length;
  $('#purchaseNavCount').textContent = sortedRequests.length;
  const executed = requests.filter((request) => getTransactionStatus(request) === 'executed');
  $('#invoiceCount').textContent = executed.length;
  const items = sortedRequests.slice(0, 40);
  $('#sidebarPurchases').innerHTML = items.length
    ? items.map((request) => {
      const status = getTransactionStatus(request);
      return `
        <button class="sidebar-purchase" type="button" data-open-purchase="${escapeHtml(request.id)}" title="${escapeHtml(request.resourceTitle)}">
          <span class="sidebar-purchase__dot${status === 'executed' ? ' sidebar-purchase__dot--executed' : ''}"></span>
          <span class="sidebar-purchase__title">${escapeHtml(request.resourceTitle || 'Achat')}</span>
          <span class="sidebar-purchase__amount">${money(request.amount)}</span>
        </button>
      `;
    }).join('')
    : '<p class="sidebar-empty">Vos achats apparaîtront ici.</p>';
}

function renderStats() {
  const executed = requests.filter((request) => getTransactionStatus(request) === 'executed');
  const pending = requests.filter((request) => getTransactionStatus(request) === 'pending_approval');
  const budgetTotal = missions.reduce((sum, mission) => sum + Number(mission.budgetTotal || 0), 0);
  const spent = executed.reduce((sum, request) => sum + Number(request.amount || 0), 0);

  $('#totalBudget').textContent = money(budgetTotal);
  $('#totalSpent').textContent = money(spent);
  $('#executedCount').textContent = `${executed.length} paiement${executed.length === 1 ? '' : 's'}`;
  $('#pendingCount').textContent = pending.length;
  $('#missionCount').textContent = missions.length;
}

function renderPaymentFlow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: flowPeriod }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (flowPeriod - index - 1));
    return { date, amount: 0, count: 0 };
  });

  requests.forEach((request) => {
    if (getTransactionStatus(request) !== 'executed') return;
    const date = new Date(request.transaction?.executedAt || request.createdAt);
    if (Number.isNaN(date.getTime())) return;
    date.setHours(0, 0, 0, 0);
    const index = Math.round((date.getTime() - today.getTime()) / 86400000) + flowPeriod - 1;
    if (index < 0 || index >= buckets.length) return;
    buckets[index].amount += Number(request.amount || 0);
    buckets[index].count += 1;
  });

  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const count = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const maxAmount = Math.max(...buckets.map((bucket) => bucket.amount), 1);
  const points = buckets.map((bucket, index) => {
    const x = (index / (buckets.length - 1)) * 100;
    const y = 44 - (bucket.amount / maxAmount) * 32;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const labels = flowPeriod === 7
    ? buckets.map((bucket) => bucket.date.toLocaleDateString('fr-FR', { weekday: 'short' }))
    : [0, 9, 19, 29].map((index) => buckets[index].date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const labelIndexes = flowPeriod === 7 ? buckets.map((_, index) => index) : [0, 9, 19, 29];

  $('#flowTotal').textContent = money(total);
  $('#flowExecutedCount').textContent = `${count} paiement${count === 1 ? '' : 's'} exécuté${count === 1 ? '' : 's'}`;
  $('#paymentFlowChart').setAttribute(
    'aria-label',
    `Montant des paiements exécutés sur les ${flowPeriod} derniers jours : ${money(total)}.`,
  );
  $('#paymentFlowChart').innerHTML = `
    <svg class="payment-flow-chart__svg" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1="12" y2="12"></line>
      <line x1="0" x2="100" y1="28" y2="28"></line>
      <line x1="0" x2="100" y1="44" y2="44"></line>
      <path class="payment-flow-chart__area" d="M0,48 ${points} 100,48Z"></path>
      <polyline class="payment-flow-chart__line" points="${points}"></polyline>
      ${buckets.map((bucket, index) => {
        const x = (index / (buckets.length - 1)) * 100;
        const y = 44 - (bucket.amount / maxAmount) * 32;
        return `<circle class="payment-flow-chart__point" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.1"></circle>`;
      }).join('')}
    </svg>
    <div class="payment-flow-chart__labels">
      ${labelIndexes.map((index, labelIndex) => `<span style="left:${(labelIndex / (labelIndexes.length - 1)) * 100}%">${escapeHtml(labels[labelIndex])}</span>`).join('')}
    </div>
  `;
}

function renderRecentPayments() {
  const recent = [...requests]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  $('#recentPayments').innerHTML = recent.length
    ? recent.map((request) => requestCard(request, false)).join('')
    : '<p class="empty-message">Aucun paiement pour le moment. Les demandes de vos agents apparaîtront ici.</p>';
}

function renderMissions() {
  const target = $('#recentMissions');
  if (!missions.length) {
    target.innerHTML = '<p class="empty-message">Aucune mission pour le moment. Décrivez votre objectif ci-dessus pour commencer.</p>';
    return;
  }

  target.innerHTML = missions.map((mission) => {
    const spent = Number(mission.budgetTotal) - Number(mission.budgetRemaining);
    const currentRequests = mission.requests || [];
    return `
      <article class="mission-row">
        <div class="mission-row__main">
          <h3>${escapeHtml(mission.objective)}</h3>
          <div class="mission-row__meta">
            <span>Budget restant : ${money(mission.budgetRemaining)} / ${money(mission.budgetTotal)}</span>
            <span>Dépensé : ${money(spent)}</span>
            <span>${currentRequests.length} demande${currentRequests.length === 1 ? '' : 's'}</span>
            <span>${dateTime(mission.createdAt)}</span>
          </div>
        </div>
        ${statusPill(mission.status)}
      </article>
    `;
  }).join('');
}

function renderPending() {
  const pending = requests.filter((request) => getTransactionStatus(request) === 'pending_approval');
  const panel = $('#pendingPanel');
  panel.hidden = !pending.length;
  $('#pendingRequests').innerHTML = pending.map((request) => requestCard(request)).join('');
}

function renderInvoices() {
  const paid = requests
    .filter((request) => getTransactionStatus(request) === 'executed')
    .sort((a, b) => new Date(b.transaction.executedAt || b.createdAt) - new Date(a.transaction.executedAt || a.createdAt));
  $('#invoiceList').innerHTML = paid.length
    ? paid.map((request) => {
      const mission = missions.find((item) => item.id === request.missionId);
      return `
        <article class="document-row">
          <div class="document-row__main">
            <h3>Reçu — ${escapeHtml(request.resourceTitle || 'Achat')}</h3>
            <div class="document-row__meta">
              <span>${escapeHtml(request.providerName || 'Fournisseur')}</span>
              <span>${dateTime(request.transaction.executedAt || request.createdAt)}</span>
              <span>Réf. ${escapeHtml(request.transaction.paypalReference || 'Sandbox')}</span>
            </div>
            <p>Mission : ${escapeHtml(mission?.objective || 'Mission')}</p>
          </div>
          <div class="document-row__actions">
            <span class="request-card__amount">${money(request.amount)}</span>
            <button class="small-button" type="button" data-print-receipt="${escapeHtml(request.id)}">Imprimer / PDF</button>
          </div>
        </article>
      `;
    }).join('')
    : '<p class="empty-message">Aucun reçu : les transactions exécutées apparaîtront ici. Vous pourrez les imprimer ou les enregistrer en PDF.</p>';
}

function renderPurchases() {
  const sortedRequests = [...requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('#allPurchases').innerHTML = sortedRequests.length
    ? sortedRequests.map((request) => requestCard(request)).join('')
    : '<p class="empty-message">Aucun achat pour le moment. Lancez une mission pour que l’agent puisse soumettre des demandes.</p>';
}

function render() {
  renderSidebar();
  renderStats();
  renderPaymentFlow();
  renderRecentPayments();
  renderMissions();
  renderPending();
  renderInvoices();
  renderPurchases();
}

async function loadOverview() {
  let result = await getOverview();
  let updatedMissions = result.missions || [];
  const processingRequests = updatedMissions
    .flatMap((mission) => mission.requests || [])
    .filter((request) => getTransactionStatus(request) === 'processing' && request.transaction?.paypalReference);
  if (processingRequests.length && Date.now() - lastPayoutStatusRefreshAt >= 10_000) {
    lastPayoutStatusRefreshAt = Date.now();
    await Promise.all(processingRequests.map((request) => refreshPayoutStatus(request.id)));
    result = await getOverview();
    updatedMissions = result.missions || [];
  }
  const snapshot = JSON.stringify(updatedMissions);
  if (snapshot === lastOverviewSnapshot) return;
  lastOverviewSnapshot = snapshot;
  missions = updatedMissions;
  requests = missions.flatMap((mission) => mission.requests || []);
  render();
}

function getConversationActivity(entry) {
  const messages = {
    exploration: 'Je consulte les ressources disponibles.',
    recherche_produits: 'Je recherche des articles génériques dans le catalogue de démonstration.',
    demande_paiement: 'Je prépare une demande à soumettre aux règles MicroPay.',
    decision_politique: 'MicroPay vérifie le budget et les règles de dépense.',
    ressource_ignoree: 'J’écarte une ressource qui ne correspond pas à la demande.',
    paiement_execute: 'Le moteur de politiques a autorisé un paiement Sandbox.',
    paiement_sandbox_en_cours: 'Le virement a été envoyé à PayPal Sandbox et son statut est en cours de vérification.',
    paiement_echec: 'Le paiement Sandbox a échoué. Consultez la section Paiements.',
    commande_demo_simulee: 'La simulation est terminée : aucun paiement ni livraison réelle.',
    validation_manuelle_approuvee: 'La demande a été approuvée et le paiement Sandbox a été exécuté.',
    validation_manuelle_refusee: 'La demande a été refusée.',
  };
  return messages[entry.etape] || '';
}

function renderMissionConversation(detail) {
  const mission = detail.mission;
  if (!mission) return;

  const snapshot = JSON.stringify(detail);
  if (snapshot === lastConversationSnapshot) return;
  lastConversationSnapshot = snapshot;

  const container = $('#missionConversation');
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  const activities = (detail.logs || [])
    .map(getConversationActivity)
    .filter(Boolean)
    .slice(-6);
  const finalLog = [...(detail.logs || [])]
    .reverse()
    .find((entry) => entry.etape === 'raisonnement_final' || entry.etape === 'mission_terminee');
  const isRunning = mission.status === 'running';
  const assistantMessage = mission.status === 'error'
    ? 'La mission a rencontré une erreur. Consultez le message affiché dans l’espace de travail, puis réessayez.'
    : finalLog?.raisonnement_agent?.trim()
      || (mission.status === 'created' ? 'La mission a été créée; l’agent va démarrer.' : '')
      || (mission.status === 'completed' ? 'Mission terminée. Consultez les demandes ci-dessous.' : '');
  const requestsMarkup = (detail.requests || []).length
    ? `<div class="mission-conversation__requests">${detail.requests.map((request) =>
      requestCard(request, true, 'conversation-request')
    ).join('')}</div>`
    : '';

  container.hidden = false;
  $('#missionPanel').classList.add('mission-chat-panel--active');
  container.innerHTML = `
    <div class="mission-conversation__message mission-conversation__message--user">
      <span class="mission-conversation__speaker">Vous</span>
      <div class="mission-conversation__bubble">${escapeHtml(mission.objective)}</div>
    </div>
    <div class="mission-conversation__message mission-conversation__message--assistant">
      <span class="mission-conversation__speaker">MicroPay</span>
      <div class="mission-conversation__bubble">
        ${activities.map((message) => `<p class="mission-conversation__activity">${escapeHtml(message)}</p>`).join('')}
        ${assistantMessage ? `<p>${escapeHtml(assistantMessage)}</p>` : ''}
        ${isRunning ? `
          <p class="mission-conversation__activity">Je prépare ma réponse
            <span class="mission-conversation__typing" aria-label="En cours">
              <span></span><span></span><span></span>
            </span>
          </p>
        ` : ''}
        ${requestsMarkup}
      </div>
    </div>
  `;
  if (wasNearBottom) {
    container.scrollTop = container.scrollHeight;
    container.scrollIntoView({ block: 'nearest' });
  }
}

function renderConversationFailure(message) {
  const container = $('#missionConversation');
  container.hidden = false;
  $('#missionPanel').classList.add('mission-chat-panel--active');
  container.insertAdjacentHTML('beforeend', `
    <div class="mission-conversation__message mission-conversation__message--assistant">
      <span class="mission-conversation__speaker">MicroPay</span>
      <div class="mission-conversation__bubble mission-conversation__error">${escapeHtml(message)}</div>
    </div>
  `);
  container.scrollTop = container.scrollHeight;
}

async function monitorMission(missionId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const detail = await getMission(missionId);
    renderMissionConversation(detail);
    if (detail.mission?.status === 'completed' || detail.mission?.status === 'error') {
      return detail;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error('L’agent n’a pas répondu dans le délai prévu. Vérifiez le serveur et réessayez.');
}

async function restoreLatestConversation() {
  const latestMission = missions[0];
  if (!latestMission) return;

  const detail = await getMission(latestMission.id);
  activeConversationMissionId = latestMission.id;
  renderMissionConversation(detail);
}

async function checkBackend() {
  const indicator = $('#backendIndicator');
  const label = $('#backendStatus');
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    indicator.classList.add('is-online');
    label.textContent = 'Serveur connecté';
  } catch {
    indicator.classList.remove('is-online');
    label.textContent = 'Serveur hors ligne';
  }
}

async function loadProviders() {
  const select = $('#allowedProviders');
  try {
    const providers = await listProviders();
    select.innerHTML = providers.map((provider) =>
      `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`
    ).join('');
  } catch (error) {
    select.disabled = true;
    showError(`Impossible de charger les fournisseurs : ${error.message}`);
  }
}

function printReceipt(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request || getTransactionStatus(request) !== 'executed') {
    showError('Ce reçu est indisponible : la transaction n’a pas été exécutée.');
    return;
  }
  const mission = missions.find((item) => item.id === request.missionId);
  const printable = $('#printReceipt');
  printable.innerHTML = `
    <h1>MicroPay — Reçu de transaction</h1>
    <p class="receipt-muted">Reçu de paiement PayPal Sandbox — document de démonstration, non valable comme facture fiscale.</p>
    <hr>
    <p><strong>Ressource :</strong> ${escapeHtml(request.resourceTitle)}</p>
    <p><strong>Fournisseur :</strong> ${escapeHtml(request.providerName)}</p>
    <p><strong>Montant :</strong> ${money(request.amount)} USD</p>
    <p><strong>Date :</strong> ${dateTime(request.transaction.executedAt || request.createdAt)}</p>
    <p><strong>Référence PayPal :</strong> ${escapeHtml(request.transaction.paypalReference || 'Non disponible')}</p>
    <p><strong>Mission :</strong> ${escapeHtml(mission?.objective || 'Mission')}</p>
    <hr>
    <p class="receipt-muted">Paiement exécuté en environnement PayPal Sandbox par MicroPay, après contrôle de la politique de dépense.</p>
  `;
  printable.setAttribute('aria-hidden', 'false');
  window.print();
  printable.setAttribute('aria-hidden', 'true');
}

$('#refreshButton').addEventListener('click', async () => {
  clearError();
  try {
    await loadOverview();
    await checkBackend();
  } catch (error) {
    showError(error.message);
  }
});

function setupVoiceInput() {
  const voiceButton = $('#voiceInputButton');
  const voiceIcon = $('#voiceInputIcon');
  const voiceStatus = $('#voiceInputStatus');
  const objective = $('#objective');
  const sendButton = $('#startMission');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function announce(message, isError = false) {
    voiceStatus.textContent = message;
    voiceStatus.hidden = !message;
    voiceStatus.classList.toggle('is-error', isError);
  }

  if (!SpeechRecognition) {
    voiceButton.disabled = true;
    voiceButton.title = 'La dictée vocale n’est pas prise en charge par ce navigateur.';
    announce('La dictée vocale n’est pas prise en charge par ce navigateur.', true);
    return;
  }

  if ('isSecureContext' in window && !window.isSecureContext) {
    voiceButton.disabled = true;
    voiceButton.title = 'La dictée vocale nécessite une connexion sécurisée (HTTPS).';
    announce('La dictée vocale nécessite une connexion sécurisée (HTTPS).', true);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'fr-FR';
  recognition.continuous = false;
  recognition.interimResults = true;

  let baseText = '';
  let hasResult = false;
  let hasError = false;

  recognition.onstart = () => {
    baseText = objective.value.trimEnd();
    hasResult = false;
    hasError = false;
    voiceButton.classList.add('is-listening');
    voiceButton.setAttribute('aria-pressed', 'true');
    voiceButton.setAttribute('aria-label', 'Arrêter la dictée vocale');
    voiceButton.title = 'Arrêter la dictée vocale';
    voiceIcon.textContent = 'stop_circle';
    sendButton.disabled = true;
    announce('Dictée en cours. Parlez maintenant.');
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
    }

    if (!transcript.trim()) return;

    hasResult = true;
    const separator = baseText && !/\s$/.test(baseText) ? ' ' : '';
    const fullText = `${baseText}${separator}${transcript.trimStart()}`;
    objective.value = fullText.slice(0, objective.maxLength);
    objective.dispatchEvent(new Event('input', { bubbles: true }));

    if (fullText.length > objective.maxLength) {
      announce('La description a atteint la limite de 1 000 caractères.');
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted') return;

    hasError = true;
    const messages = {
      'audio-capture': 'Aucun microphone n’a été détecté.',
      'no-speech': 'Aucune parole détectée. Réessayez.',
      'not-allowed': 'Accès au microphone refusé. Autorisez-le dans les paramètres du navigateur.',
      'service-not-allowed': 'Le service de reconnaissance vocale n’est pas autorisé.',
      network: 'La reconnaissance vocale nécessite une connexion réseau.',
    };
    announce(messages[event.error] || 'Une erreur est survenue pendant la dictée vocale.', true);
  };

  recognition.onend = () => {
    voiceButton.classList.remove('is-listening');
    voiceButton.setAttribute('aria-pressed', 'false');
    voiceButton.setAttribute('aria-label', 'Décrire la mission à la voix');
    voiceButton.title = 'Décrire la mission à la voix';
    voiceIcon.textContent = 'mic';
    sendButton.disabled = false;

    if (!hasError) {
      announce(hasResult ? 'Dictée terminée.' : 'Dictée arrêtée.');
    }
  };

  voiceButton.addEventListener('click', () => {
    if (voiceButton.getAttribute('aria-pressed') === 'true') {
      recognition.stop();
      return;
    }

    announce('');
    try {
      recognition.start();
    } catch (error) {
      const message = error.name === 'InvalidStateError'
        ? 'La dictée vocale est déjà en cours.'
        : 'Impossible de démarrer la dictée vocale. Vérifiez l’accès au microphone.';
      announce(message, true);
    }
  });
}

setupVoiceInput();

$('#objective').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat) return;
  event.preventDefault();
  if (!$('#startMission').disabled) $('#missionForm').requestSubmit();
});

$('#missionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setView('create');
  clearError();
  const button = $('#startMission');
  const status = $('#formStatus');
  const objective = $('#objective').value.trim();
  button.disabled = true;
  status.classList.remove('is-error');
  status.textContent = 'Création de la mission…';

  const budgetTotal = Number($('#budgetTotal').value);
  const autoApproveThreshold = Number($('#autoApproveThreshold').value);
  if (autoApproveThreshold > budgetTotal) {
    status.textContent = 'Le seuil d’auto-approbation ne peut pas dépasser le budget total.';
    status.classList.add('is-error');
    button.disabled = false;
    return;
  }

  activeConversationMissionId = null;
  lastConversationSnapshot = '';
  renderMissionConversation({
    mission: { objective, status: 'created' },
    logs: [],
    requests: [],
  });

  try {
    const allowedProviders = [...$('#allowedProviders').selectedOptions].map((option) => option.value);
    const { mission } = await createMission({
      objective,
      budgetTotal,
      autoApproveThreshold,
      maxPaymentsPerMinute: Number($('#maxPaymentsPerMinute').value),
      minConfidence: Number($('#minConfidence').value),
      allowedProviders,
    });
    activeConversationMissionId = mission.id;
    $('#objective').value = '';
    await loadOverview();
    status.textContent = 'Mission créée. Démarrage de l’agent…';
    await runMission(mission.id);
    status.textContent = 'L’agent travaille. Sa réponse apparaîtra dans cette conversation.';
    const detail = await monitorMission(mission.id);
    await loadOverview();
    if (detail.mission.status === 'error') {
      status.textContent = 'La mission a échoué. Consultez le message et réessayez.';
      status.classList.add('is-error');
      showError('La mission n’a pas pu être terminée. Vérifiez la connexion au modèle et au catalogue.');
    } else {
      status.textContent = 'Réponse de l’agent affichée dans la conversation.';
    }
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('is-error');
    showError(error.message);
    renderConversationFailure(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const approveButton = event.target.closest('[data-approve]');
  const rejectButton = event.target.closest('[data-reject]');
  const purchaseButton = event.target.closest('[data-open-purchase]');
  const printButton = event.target.closest('[data-print-receipt]');

  if (printButton) {
    printReceipt(printButton.dataset.printReceipt);
    return;
  }
  if (purchaseButton) {
    setView('purchases');
    document.getElementById(`request-${CSS.escape(purchaseButton.dataset.openPurchase)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!approveButton && !rejectButton) return;

  const button = approveButton || rejectButton;
  const requestId = button.dataset.approve || button.dataset.reject;
  button.disabled = true;
  clearError();
  try {
    if (approveButton) await approveRequest(requestId);
    else await rejectRequest(requestId);
    await loadOverview();
    if (activeConversationMissionId) {
      renderMissionConversation(await getMission(activeConversationMissionId));
    }
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
});

document.querySelectorAll('[data-flow-period]').forEach((button) => {
  button.addEventListener('click', () => {
    flowPeriod = Number(button.dataset.flowPeriod);
    document.querySelectorAll('[data-flow-period]').forEach((periodButton) => {
      const active = periodButton === button;
      periodButton.classList.toggle('is-active', active);
      periodButton.setAttribute('aria-pressed', String(active));
    });
    renderPaymentFlow();
  });
});

$('#missionForm').addEventListener('input', () => {
  $('#formStatus').textContent = '';
  $('#formStatus').classList.remove('is-error');
});

function setupRotatingCarousel(containerSelector, itemSelector, interval) {
  const container = $(containerSelector);
  const slides = [...container.querySelectorAll(itemSelector)];
  let activeIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));

  function showNextSlide() {
    slides[activeIndex].classList.remove('is-active');
    slides[activeIndex].setAttribute('aria-hidden', 'true');
    activeIndex = (activeIndex + 1) % slides.length;
    slides[activeIndex].classList.add('is-active');
    slides[activeIndex].setAttribute('aria-hidden', 'false');
  }

  const timer = window.setInterval(showNextSlide, interval);
  return () => window.clearInterval(timer);
}

function setupRotatingDemoCard(cardSelector, interval) {
  const card = $(cardSelector);
  if (!card) return () => {};

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let flipped = false;
  let timer;

  function flipCard() {
    flipped = !flipped;
    card.classList.toggle('is-flipped', flipped);
    card.setAttribute('aria-pressed', String(flipped));
  }

  function restartTimer() {
    if (timer !== undefined) window.clearInterval(timer);
    if (!prefersReducedMotion) timer = window.setInterval(flipCard, interval);
  }

  function handleCardClick() {
    flipCard();
    restartTimer();
  }

  card.addEventListener('click', handleCardClick);
  restartTimer();

  return () => {
    if (timer !== undefined) window.clearInterval(timer);
    card.removeEventListener('click', handleCardClick);
  };
}

function setupMissionNetwork() {
  const svg = $('#missionNetworkSvg');
  if (!svg) return;

  const namespace = 'http://www.w3.org/2000/svg';
  const center = { x: 313, y: 313 };
  const innerRing = Array.from({ length: 12 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 12;
    return {
      x: center.x + Math.cos(angle) * 145,
      y: center.y + Math.sin(angle) * 145,
      radius: 4.2,
    };
  });
  const outerRing = Array.from({ length: 24 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 24;
    return {
      x: center.x + Math.cos(angle) * 274,
      y: center.y + Math.sin(angle) * 274,
      radius: index % 6 === 0 ? 5.5 : 3.4,
    };
  });
  const points = [{ ...center, radius: 7 }, ...innerRing, ...outerRing];
  const innerStart = 1;
  const outerStart = innerStart + innerRing.length;
  const edges = [];

  function addEdge(from, to) {
    if (from === to) return;
    edges.push([from, to]);
  }

  for (let index = 0; index < outerRing.length; index += 1) {
    addEdge(outerStart + index, outerStart + ((index + 1) % outerRing.length));
    addEdge(outerStart + index, outerStart + ((index + 2) % outerRing.length));
    const innerIndex = Math.floor(index / 2);
    addEdge(outerStart + index, innerStart + innerIndex);
    addEdge(outerStart + index, innerStart + ((innerIndex + 1) % innerRing.length));
  }

  for (let index = 0; index < innerRing.length; index += 1) {
    addEdge(innerStart + index, innerStart + ((index + 1) % innerRing.length));
    addEdge(0, innerStart + index);
  }

  const edgeGroup = document.createElementNS(namespace, 'g');
  edges.forEach(([from, to], index) => {
    const line = document.createElementNS(namespace, 'line');
    line.setAttribute('x1', String(points[from].x));
    line.setAttribute('y1', String(points[from].y));
    line.setAttribute('x2', String(points[to].x));
    line.setAttribute('y2', String(points[to].y));
    line.setAttribute('pathLength', '1');
    line.classList.add('mission-network-edge');
    line.style.setProperty('--network-delay', `${1.7 + index * 0.045}s`);
    edgeGroup.append(line);
  });

  const pointGroup = document.createElementNS(namespace, 'g');
  points.forEach((point, index) => {
    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', String(point.x));
    circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', String(point.radius));
    circle.classList.add('mission-network-dot');
    circle.style.setProperty('--network-delay', `${index * 0.038}s`);
    pointGroup.append(circle);
  });

  svg.append(edgeGroup, pointGroup);
}

const stopPromoCarousel = setupRotatingCarousel(
  '#workspacePromo',
  '[data-promo-slide]',
  6500,
);
const stopStatsCarousel = setupRotatingCarousel(
  '#workspaceStats',
  '[data-stat-slide]',
  4500,
);
const stopDemoCard = setupRotatingDemoCard('#workspaceDemoCard', 4000);
setupMissionNetwork();

await checkBackend();
await loadProviders();
try {
  await loadOverview();
  await restoreLatestConversation();
} catch (error) {
  showError(error.message);
}

refreshTimer = window.setInterval(async () => {
  try {
    await loadOverview();
    clearError();
  } catch (error) {
    showError(error.message);
  }
  await checkBackend();
}, 4000);

window.addEventListener('beforeunload', () => {
  window.clearInterval(refreshTimer);
  stopPromoCarousel();
  stopStatsCarousel();
  stopDemoCard();
});
