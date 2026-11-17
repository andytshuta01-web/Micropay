// Module PayPal — seul composant du système autorisé à exécuter un virement réel.
// On utilise l'API Payouts (pas Checkout) : un paiement déclenché par un agent
// autonome est un envoi d'argent sortant, sans approbation interactive d'un
// acheteur humain — exactement ce que fait Payouts.

import { config } from './config.js';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { clientId, clientSecret, baseUrl } = config.paypal;
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET manquants dans .env');
  }

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Échec d'authentification PayPal (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Exécute un paiement sortant réel en sandbox vers l'email du fournisseur.
 * @param {object} params
 * @param {number} params.amount
 * @param {string} params.receiverEmail
 * @param {string} params.note
 * @param {string} [params.senderBatchId] Stable ID to make retries idempotent.
 * @returns {Promise<{status:string, paypalReference:string, raw:object}>}
 */
export async function sendPayout({ amount, receiverEmail, note, senderBatchId }) {
  const payoutAmount = Number(amount);

  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    throw new Error('Montant de paiement invalide.');
  }
  if (!receiverEmail) {
    throw new Error('Adresse e-mail du destinataire PayPal manquante.');
  }

  const token = await getAccessToken();
  const batchId = senderBatchId || `micropay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${config.paypal.baseUrl}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'Paiement MicroPay',
        email_message: note || 'Paiement automatique déclenché par un agent MicroPay',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: payoutAmount.toFixed(2), currency: 'USD' },
          receiver: receiverEmail,
          note: note || 'Paiement MicroPay',
          sender_item_id: batchId,
        },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Échec du paiement PayPal: ${JSON.stringify(data)}`);
  }

  return {
    status: data.batch_header?.batch_status || 'PENDING',
    paypalReference: data.batch_header?.payout_batch_id || batchId,
    raw: data,
  };
}

export async function getPayoutStatus(payoutBatchId) {
  if (!payoutBatchId) throw new Error('Référence de lot PayPal manquante.');

  const token = await getAccessToken();
  const res = await fetch(
    `${config.paypal.baseUrl}/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?fields=all`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Impossible de vérifier le paiement PayPal (${res.status}): ${JSON.stringify(data)}`);
  }

  return {
    status: data.batch_header?.batch_status || 'PENDING',
    paypalReference: data.batch_header?.payout_batch_id || payoutBatchId,
    raw: data,
  };
}
