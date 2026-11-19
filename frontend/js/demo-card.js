export function setupRotatingDemoCard(card, interval = 4000) {
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
