const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    if (location.protocol === 'file:') {
      throw new Error(
        'Ouvrez MicroPay depuis son serveur backend, pas directement depuis un fichier, et vérifiez que le serveur est démarré.',
      );
    }
    throw new Error(
      `Impossible de contacter le serveur MicroPay à ${location.origin}. Vérifiez que le backend est démarré et rechargez la page.`,
    );
  }
  const data = res.status === 204 ? null : await res.json();
  if (res.status === 401) {
    window.location.replace('login.html?next=workspace.html');
    throw new Error(data?.error || 'Veuillez vous connecter pour continuer.');
  }
  if (!res.ok) throw new Error(data?.error || 'Erreur de communication avec le serveur.');
  return data;
}

export async function createMission(payload) {
  return apiRequest('/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function runMission(id) {
  return apiRequest(`/missions/${id}/run`, { method: 'POST' });
}

export async function getMission(id) {
  return apiRequest(`/missions/${id}`);
}

export async function listMissions() {
  return apiRequest('/missions');
}

export async function getOverview() {
  return apiRequest('/missions/overview');
}

export async function approveRequest(requestId) {
  return apiRequest(`/missions/requests/${requestId}/approve`, { method: 'POST' });
}

export async function refreshPayoutStatus(requestId) {
  return apiRequest(`/missions/requests/${requestId}/status`);
}

export async function rejectRequest(requestId) {
  return apiRequest(`/missions/requests/${requestId}/reject`, { method: 'POST' });
}

export async function listResources() {
  return apiRequest('/resources');
}

export async function listProviders() {
  return apiRequest('/providers');
}
