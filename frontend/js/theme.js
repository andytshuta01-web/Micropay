(function () {
  const root = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  const colorPreferenceKey = 'micropay-appearance-colors';
  const buttonColorInput = document.querySelector('[data-appearance-color="button"]');
  const titleColorInput = document.querySelector('[data-appearance-color="title"]');
  const resetColorsButton = document.getElementById('resetAppearanceColors');
  const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

  function readColorPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(colorPreferenceKey) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return {
        button: isHexColor(saved.button) ? saved.button : '',
        buttonText: isHexColor(saved.buttonText) ? saved.buttonText : '',
        buttonHover: isHexColor(saved.buttonHover) ? saved.buttonHover : '',
        title: isHexColor(saved.title) ? saved.title : ''
      };
    } catch (error) {
      console.warn('Les couleurs personnalisées ne peuvent pas être lues.', error);
      return {};
    }
  }

  let colorPreferences = readColorPreferences();

  function getButtonTextColor(hex) {
    const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
    const luminance = channels
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance > 0.179 ? '#17191d' : '#ffffff';
  }

  function getButtonHoverColor(hex) {
    const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16));
    const luminance = channels
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const target = luminance > 0.179 ? 0 : 255;
    return `#${channels.map((channel) => Math.round(channel + (target - channel) * 0.12).toString(16).padStart(2, '0')).join('')}`;
  }

  function applyColorPreferences() {
    if (colorPreferences.button) {
      root.style.setProperty('--user-button-color', colorPreferences.button);
      root.style.setProperty('--button-primary', colorPreferences.button);
      colorPreferences.buttonText = getButtonTextColor(colorPreferences.button);
      colorPreferences.buttonHover = getButtonHoverColor(colorPreferences.button);
      root.style.setProperty('--user-button-text-color', colorPreferences.buttonText);
      root.style.setProperty('--button-primary-text', colorPreferences.buttonText);
      root.style.setProperty('--user-button-hover-color', colorPreferences.buttonHover);
      root.style.setProperty('--button-primary-hover', colorPreferences.buttonHover);
    } else {
      root.style.removeProperty('--user-button-color');
      root.style.removeProperty('--button-primary');
      root.style.removeProperty('--user-button-text-color');
      root.style.removeProperty('--button-primary-text');
      root.style.removeProperty('--user-button-hover-color');
      root.style.removeProperty('--button-primary-hover');
    }

    if (colorPreferences.title) {
      root.dataset.customTitleColor = 'true';
      root.style.setProperty('--user-title-color', colorPreferences.title);
    } else {
      delete root.dataset.customTitleColor;
      root.style.removeProperty('--user-title-color');
    }

    if (buttonColorInput) {
      const defaultButton = getComputedStyle(root).getPropertyValue('--button-primary').trim();
      buttonColorInput.value = colorPreferences.button || (/^#[0-9a-f]{6}$/i.test(defaultButton) ? defaultButton : '#f5f5f5');
    }
    if (titleColorInput) {
      titleColorInput.value = colorPreferences.title || (root.dataset.theme === 'light' ? '#17191d' : '#f5f5f5');
    }
  }

  function saveColorPreferences() {
    const saved = {};
    if (colorPreferences.button) {
      saved.button = colorPreferences.button;
      saved.buttonText = colorPreferences.buttonText;
      saved.buttonHover = colorPreferences.buttonHover;
    }
    if (colorPreferences.title) saved.title = colorPreferences.title;

    try {
      if (Object.keys(saved).length) {
        localStorage.setItem(colorPreferenceKey, JSON.stringify(saved));
      } else {
        localStorage.removeItem(colorPreferenceKey);
      }
    } catch (error) {
      console.warn('Les couleurs personnalisées ne peuvent pas être enregistrées.', error);
    }
  }

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
    applyColorPreferences();
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

  [buttonColorInput, titleColorInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      if (input.dataset.appearanceColor === 'button') {
        colorPreferences.button = input.value.toLowerCase();
        colorPreferences.buttonText = getButtonTextColor(colorPreferences.button);
        colorPreferences.buttonHover = getButtonHoverColor(colorPreferences.button);
      } else {
        colorPreferences.title = input.value.toLowerCase();
      }
      applyColorPreferences();
      saveColorPreferences();
    });
  });

  if (resetColorsButton) {
    resetColorsButton.addEventListener('click', () => {
      colorPreferences = {};
      applyColorPreferences();
      saveColorPreferences();
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !button.querySelector('.ui-icon, .fa-solid, .theme-toggle__icon')) return;
    document.querySelectorAll('button.has-red-icon').forEach((selected) => selected.classList.remove('has-red-icon'));
    button.classList.add('has-red-icon');
  });

  updateButtons();
}());
