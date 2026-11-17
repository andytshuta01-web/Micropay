(function () {
  let theme = 'dark';
  try {
    const savedTheme = localStorage.getItem('micropay-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme;
  } catch (error) {
    console.warn('La préférence de thème ne peut pas être lue.', error);
  }
  document.documentElement.dataset.theme = theme;
}());
