(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('button, .home-button');
    if (!target || reducedMotion) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ui-ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    if (window.getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }
    target.style.overflow = 'hidden';
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }, { passive: true });

  function showToast(message) {
    let region = document.querySelector('.ui-toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'ui-toast-region';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = 'ui-toast';
    toast.innerHTML = `<i class="ui-toast__icon ui-icon fa-solid fa-check" aria-hidden="true"></i><span></span>`;
    toast.querySelector('span:last-child').textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2600);
  }

  document.addEventListener('click', (event) => {
    const decisionButton = event.target.closest('[data-approve], [data-reject]');
    if (!decisionButton) return;
    showToast(decisionButton.dataset.approve
      ? 'Paiement approuvé - mise à jour en cours.'
      : 'Demande refusée - mise à jour en cours.');
  });

  const viewObserver = new MutationObserver(() => {
    document.querySelectorAll('.workspace-view').forEach((view) => {
      if (view.hidden) return;
      view.classList.remove('is-entering');
      void view.offsetWidth;
      view.classList.add('is-entering');
    });
  });
  document.querySelectorAll('.workspace-view').forEach((view) => {
    viewObserver.observe(view, { attributes: true, attributeFilter: ['hidden'] });
  });

  if (!reducedMotion) {
    document.querySelectorAll('.workspace-card-scene').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return;
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(800px) rotateX(${-y * 5}deg) rotateY(${x * 7}deg)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });
  }
}());
