import express from 'express';
import bcrypt from 'bcryptjs';
import { stmts } from './db.js';

export const authRouter = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, created_at: user.created_at };
}

export function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  const user = stmts.findUserById.get(req.session.userId);
  if (!user) {
    req.session = null;
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = user;
  next();
}

authRouter.post('/signup', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 6 characters' });
  }
  if (stmts.findUserByEmail.get(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const pwHash = bcrypt.hashSync(password, 10);
  const user = stmts.insertUser.get(email, pwHash);
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});

authRouter.post('/login', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');

  const user = stmts.findUserByEmail.get(email);
  if (!user || !bcrypt.compareSync(password, user.pw_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const user = stmts.findUserById.get(req.session.userId);
  res.json({ user: safeUser(user) });
});
