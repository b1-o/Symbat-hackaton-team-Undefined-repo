import path from 'node:path';
import express from 'express';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { createLlmAdapter, readLlmConfig } from './llm.js';

const root = process.cwd();
const production = process.env.NODE_ENV === 'production';
const demoMode = process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !production;
const organizerPassword = process.env.ORGANIZER_PASSWORD || '';
if (!demoMode && organizerPassword.length < 12) throw new Error('Set ORGANIZER_PASSWORD (at least 12 characters) or explicitly enable DEMO_MODE=true.');
if (production && !demoMode && !process.env.CHALLENGE_ACCESS_CODE) throw new Error('Set a private CHALLENGE_ACCESS_CODE for a real pilot.');
const db = createDatabase(process.env.DB_PATH || path.join(root, 'data', 'startify.db'), { seedDemo: process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : demoMode });
const llm = createLlmAdapter(readLlmConfig());
const app = createApp({ db, llm, demoMode, organizerPassword, inviteCode: process.env.CHALLENGE_ACCESS_CODE, secureCookies: production && process.env.COOKIE_SECURE !== 'false', appOrigin: process.env.APP_ORIGIN || '' });
app.use('/docs', express.static(path.join(root, 'docs'), { index: false, dotfiles: 'deny', setHeaders(res) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); } }));
const port = Number(process.env.PORT || 3000);
let vite;
if (production) {
  app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: path.join(root, 'vite.config.js'), root, server: { middlewareMode: true, hmr: false, allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(port, '0.0.0.0', () => console.log(`Startify Sprint on http://0.0.0.0:${port} | demo=${demoMode} | llm=${llm.publicStatus().enabled}`));
async function shutdown() { server.close(); await vite?.close(); db.close(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
