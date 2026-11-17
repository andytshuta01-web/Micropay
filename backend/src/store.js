// Persistance simple en fichier JSON — suffisant pour une démo de hackathon.
// Pas de base de données réelle : tout tient dans data/db.json.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MICROPAY_DB_PATH
  ? path.resolve(process.env.MICROPAY_DB_PATH)
  : path.join(__dirname, '..', 'data', 'db.json');

function emptyDb() {
  return {
    users: {},           // id -> Compte utilisateur
    sessions: {},        // hash du jeton -> session
    missions: {},        // id -> Mission
    policies: {},        // missionId -> PolitiqueDeDepense
    requests: {},         // id -> DemandeDePaiement (+ decision + transaction fusionnées pour simplifier)
    logs: {},             // missionId -> [LogDeDecision]
  };
}

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadDb() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const db = emptyDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return db;
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const normalized = { ...emptyDb(), ...db };
  normalized.users ||= {};
  normalized.sessions ||= {};
  normalized.missions ||= {};
  normalized.policies ||= {};
  normalized.requests ||= {};
  normalized.logs ||= {};
  return normalized;
}

let db = loadDb();

export function saveDb() {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function getDb() {
  return db;
}

export function resetDb() {
  db = emptyDb();
  saveDb();
  return db;
}
