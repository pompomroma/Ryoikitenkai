import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST, PORT, ROOT_DIR, SESSION_SECRET } from './src/config.js';
import './src/db.js';
import { authRouter } from './src/auth.js';
import { apiRouter } from './src/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(
  cookieSession({
    name: 'ryoikitenkai_session',
    keys: [SESSION_SECRET],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  })
);

app.use('/api', authRouter);
app.use('/api', apiRouter);

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(ROOT_DIR, 'public'), { index: 'index.html' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res
    .status(500)
    .json({ error: err && err.message ? err.message : 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Ryoikitenkai listening on http://${HOST}:${PORT}`);
});
