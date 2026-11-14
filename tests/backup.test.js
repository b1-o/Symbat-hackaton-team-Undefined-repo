import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../server/db.js';
const exec = promisify(execFile);
test('online backup includes committed WAL changes and passes integrity checks', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'startify-backup-test-'));
  const filename = path.join(directory, 'source.db');
  const db = createDatabase(filename, { seedDemo: false });
  try {
    db.prepare('INSERT INTO schools VALUES (?, ?, ?, ?, ?, 0)').run(
      'school-backup',
      'Backup School',
      'backup school',
      'KZ',
      'Almaty',
    );
    const { stdout } = await exec(process.execPath, ['scripts/backup.js', path.join(directory, 'backups')], {
      env: { ...process.env, DB_PATH: filename },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.verified, true);
    assert.ok(result.bytes > 0);
    const copy = new DatabaseSync(result.destination, { readOnly: true });
    try {
      assert.equal(
        copy.prepare('SELECT name FROM schools WHERE id=?').get('school-backup').name,
        'Backup School',
      );
    } finally {
      copy.close();
    }
    assert.equal(fs.statSync(result.destination).mode & 0o777, 0o600);
    assert.equal(
      fs.readdirSync(path.join(directory, 'backups')).filter((name) => name.endsWith('.db')).length,
      1,
    );
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
