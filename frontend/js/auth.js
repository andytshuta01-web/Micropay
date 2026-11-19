(function () {
  const accountEmails = document.querySelectorAll('[data-account-email]');

  if (accountEmails.length) {
    fetch('/api/auth/me')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.user) {
          accountEmails.forEach((element) => {
            element.textContent = data.user.email;
          });
        }
      })
      .catch(() => {
        accountEmails.forEach((element) => {
          element.textContent = 'Indisponible';
        });
      });
  }

  document.querySelectorAll('[data-logout-button]').forEach((logoutButton) => {
    const logoutStatus = document.getElementById(logoutButton.dataset.logoutStatus);
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      if (logoutStatus) logoutStatus.textContent = '';
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw new Error('La déconnexion a échoué. Réessayez.');
        window.location.replace('index.html');
      } catch (error) {
        if (logoutStatus) logoutStatus.textContent = error.message || 'Impossible de contacter le serveur.';
        logoutButton.disabled = false;
      }
    });
  });

  const form = document.getElementById('authForm');
  if (!form) return;

  const status = document.getElementById('authStatus');
  const mode = form.dataset.authMode;
  const destination = 'workspace.html';

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('auth-status--error', isError);
    status.classList.toggle('auth-status--success', !isError && Boolean(message));
  }

  async function getErrorMessage(response, fallback) {
    const body = await response.text();
    if (!body) return fallback;

    try {
      const data = JSON.parse(body);
      return typeof data.error === 'string' ? data.error : fallback;
    } catch (error) {
      if (error instanceof SyntaxError) return fallback;
      throw error;
    }
  }

  fetch('/api/auth/me')
    .then(async (response) => {
      if (response.ok) window.location.replace(destination);
      else if (response.status !== 401) {
        const message = await getErrorMessage(
          response,
          `Impossible de vérifier la session (HTTP ${response.status}).`,
        );
        setStatus(message, true);
      }
    })
    .catch(() => setStatus('Le serveur MicroPay est indisponible.', true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('', false);
    const submitButton = form.querySelector('[type="submit"]');
    const password = form.elements.password.value;
    if (mode === 'register' && password !== form.elements.confirmPassword.value) {
      setStatus('Les mots de passe ne correspondent pas.', true);
      return;
    }

    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.elements.email.value, password }),
      });
      if (!response.ok) {
        const message = await getErrorMessage(
          response,
          `La demande a échoué (HTTP ${response.status}).`,
        );
        throw new Error(message);
      }
      setStatus('Connexion réussie. Ouverture de votre espace…', false);
      window.location.assign(destination);
    } catch (error) {
      setStatus(error.message || 'Impossible de contacter le serveur MicroPay.', true);
      submitButton.disabled = false;
    }
  });
}());
