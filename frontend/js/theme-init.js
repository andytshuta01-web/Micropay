(function () {
  const root = document.documentElement;
  const colorPreferenceKey = 'micropay-appearance-colors';
  const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  let theme = 'dark';
  try {
    const savedTheme = localStorage.getItem('micropay-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme;
  } catch (error) {
    console.warn('La préférence de thème ne peut pas être lue.', error);
  }
  root.dataset.theme = theme;

  try {
    const savedLanguage = localStorage.getItem('micropay-language');
    if (savedLanguage === 'fr' || savedLanguage === 'en') root.lang = savedLanguage;
  } catch (error) {
    console.warn('La préférence de langue ne peut pas être lue.', error);
  }

  try {
    const savedColors = JSON.parse(localStorage.getItem(colorPreferenceKey) || '{}');
    if (savedColors && typeof savedColors === 'object' && !Array.isArray(savedColors)) {
      if (isHexColor(savedColors.button)) {
        root.style.setProperty('--user-button-color', savedColors.button);
        root.style.setProperty('--button-primary', savedColors.button);
      }
      if (isHexColor(savedColors.buttonText)) {
        root.style.setProperty('--user-button-text-color', savedColors.buttonText);
        root.style.setProperty('--button-primary-text', savedColors.buttonText);
      }
      if (isHexColor(savedColors.buttonHover)) {
        root.style.setProperty('--user-button-hover-color', savedColors.buttonHover);
        root.style.setProperty('--button-primary-hover', savedColors.buttonHover);
      }
      if (isHexColor(savedColors.title)) {
        root.dataset.customTitleColor = 'true';
        root.style.setProperty('--user-title-color', savedColors.title);
      }
    }
  } catch (error) {
    console.warn('Les couleurs personnalisées ne peuvent pas être lues.', error);
  }
}());
