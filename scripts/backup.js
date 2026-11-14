import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';

const source = path.resolve(process.env.DB_PATH || 'data/startify.db');
const directory = path.resolve(process.argv[2] || 'backups');
if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = path.join(
  directory,
  `startify-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`,
);
if (fs.existsSync(destination)) throw new Error('Backup destination already exists.');
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination); // Online SQLite backup includes committed WAL pages.
  fs.chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('Backup integrity check failed.');
    if (copy.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Backup foreign key check failed.');
  } finally {
    copy.close();
  }
  console.log(
    JSON.stringify({ ok: true, destination, bytes: fs.statSync(destination).size, verified: true }),
  );
} catch (error) {
  fs.rmSync(destination, { force: true });
  throw error;
} finally {
  db.close();
}
