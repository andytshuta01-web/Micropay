import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { missionsRouter } from './routes/missions.js';
import { listProviders, listResources } from './providers.js';

const app = express();
const frontendPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/resources', (req, res) => res.json(listResources()));
app.get('/api/providers', (req, res) => res.json(listProviders()));
app.use('/api/missions', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin === expectedOrigin) return next();
  return res.status(403).json({ error: 'Origine de requête non autorisée.' });
});
app.use('/api/missions', missionsRouter);
app.use(express.static(frontendPath));

app.listen(config.port, '127.0.0.1', () => {
  console.log(`MicroPay backend lancé sur http://localhost:${config.port}`);
  console.log(`Interface MicroPay disponible sur http://localhost:${config.port}`);
  if (!config.groq.apiKey) console.warn('⚠️  GROQ_API_KEY manquant — l\'agent ne pourra pas raisonner.');
  if (!config.paypal.clientId) console.warn('⚠️  PAYPAL_CLIENT_ID manquant — les paiements échoueront.');
});
