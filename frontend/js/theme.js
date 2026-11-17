(function () {
  const root = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme-toggle]');

  function makeIcon(theme) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('theme-toggle__icon', `theme-toggle__icon--${theme}`);

    if (theme === 'sun') {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '4');
      svg.append(circle);
      const rays = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      rays.setAttribute('d', 'M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42');
      svg.append(rays);
    } else {
      const moon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      moon.setAttribute('d', 'M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z');
      svg.append(moon);
    }

    return svg;
  }

  function updateButtons() {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    const icon = nextTheme === 'light' ? 'sun' : 'moon';
    const label = `Activer le mode ${nextTheme === 'light' ? 'clair' : 'sombre'}`;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = root.dataset.theme === 'light' ? '#f4f5f7' : '#080808';
    buttons.forEach((button) => {
      button.replaceChildren(makeIcon(icon));
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(root.dataset.theme === 'light'));
    });
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = nextTheme;
      updateButtons();
      try {
        localStorage.setItem('micropay-theme', nextTheme);
      } catch (error) {
        console.warn('La préférence de thème ne peut pas être enregistrée.', error);
      }
    });
  });

  updateButtons();
}());
