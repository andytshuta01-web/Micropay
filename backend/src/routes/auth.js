import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDb, saveDb } from '../store.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'micropay_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SESSION_DURATION_SECONDS = SESSION_DURATION_MS / 1000;
const SCRYPT_COST = 32768;

export const authRouter = Router();

authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: 'Origine de requête non autorisée.' });
  }
  return next();
});

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const cookies = req.headers.cookie?.split(';') || [];
  const cookie = cookies.find((entry) => entry.trim().startsWith(`${name}=`));
  return cookie ? cookie.trim().slice(name.length + 1) : '';
}

function setSessionCookie(res, token, req) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${secure}`,
  );
}

function clearSessionCookie(res, req) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: SCRYPT_COST, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, passwordHash) {
  const [algorithm, costText, saltText, hashText] = String(passwordHash || '').split('$');
  const cost = Number(costText);
  if (algorithm !== 'scrypt' || !Number.isInteger(cost) || cost < 16384 || cost > 131072 ||
      !/^[a-f0-9]{32}$/i.test(saltText || '') || !/^[a-f0-9]{128}$/i.test(hashText || '')) {
    return false;
  }
  const expected = Buffer.from(hashText, 'hex');
  const actual = await scrypt(password, Buffer.from(saltText, 'hex'), expected.length, {
    N: cost,
    maxmem: 256 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

authRouter.post('/register', async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Saisissez une adresse e-mail valide.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir entre 8 et 128 caractères.' });
  }

  try {
    const db = getDb();
    if (Object.values(db.users).some((user) => String(user.email || '').toLowerCase() === email)) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
    }
    const passwordHash = await hashPassword(password);
    if (Object.values(db.users).some((user) => String(user.email || '').toLowerCase() === email)) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    const user = {
      id: nanoid(16),
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    db.users[user.id] = user;

    const token = randomBytes(32).toString('hex');
    db.sessions[hashToken(token)] = {
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    saveDb();
    setSessionCookie(res, token, req);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = Object.values(getDb().users)
    .find((candidate) => String(candidate.email || '').toLowerCase() === email);

  try {
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
    }

    const db = getDb();
    const token = randomBytes(32).toString('hex');
    db.sessions[hashToken(token)] = {
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    saveDb();
    setSessionCookie(res, token, req);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.get('/me', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  const sessionKey = token && hashToken(token);
  const db = getDb();
  const session = sessionKey && db.sessions[sessionKey];
  const user = session && Date.parse(session.expiresAt) > Date.now() ? db.users[session.userId] : null;

  if (!user) {
    if (sessionKey && session) {
      delete db.sessions[sessionKey];
      saveDb();
    }
    return res.status(401).json({ error: 'Session expirée ou absente.' });
  }
  return res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const db = getDb();
    delete db.sessions[hashToken(token)];
    saveDb();
  }
  clearSessionCookie(res, req);
  return res.status(204).end();
});

export function requireAuth(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const token = readCookie(req, SESSION_COOKIE);
  const sessionKey = token && hashToken(token);
  const db = getDb();
  const session = sessionKey && db.sessions[sessionKey];
  const user = session && Date.parse(session.expiresAt) > Date.now() ? db.users[session.userId] : null;

  if (!user) {
    if (sessionKey && session) {
      delete db.sessions[sessionKey];
      saveDb();
    }
    return res.status(401).json({ error: 'Veuillez vous connecter pour continuer.' });
  }
  req.user = publicUser(user);
  return next();
}
