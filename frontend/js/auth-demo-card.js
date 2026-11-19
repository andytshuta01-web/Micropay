import { setupRotatingDemoCard } from './demo-card.js';

document.querySelectorAll('[data-auth-demo-card]').forEach((card) => {
  setupRotatingDemoCard(card);
});
