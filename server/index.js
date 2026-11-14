import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const db = openDatabase();
const app = await createApp({ db, root: process.cwd(), isProduction, frontend: true });

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Startify Sprint listening on http://0.0.0.0:${port} (${isProduction ? 'production' : 'development'})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
