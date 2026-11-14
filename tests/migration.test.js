import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { createDatabase, resetDemoData } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createLlmAdapter, readLlmConfig } from '../server/llm.js';

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startify-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'startify.db');
}
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

// Schema exactly as shipped in v0.2.0, before the coordinator role existed.
const V020 = `
  CREATE TABLE challenges (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
    access_code TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, country_code TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0, UNIQUE(country_code, normalized_name, city));
  CREATE TABLE teams (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id), school_id TEXT NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL, normalized_name TEXT NOT NULL, nickname TEXT NOT NULL, referred_by_school_id TEXT REFERENCES schools(id),
    created_at TEXT NOT NULL, started_at TEXT, access_hash TEXT, consent_at TEXT, UNIQUE(challenge_id, school_id, normalized_name));
  CREATE TABLE steps (team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY (team_id, step_index));
  CREATE TABLE submissions (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, challenge_id TEXT NOT NULL REFERENCES challenges(id),
    title TEXT NOT NULL, url TEXT NOT NULL, normalized_url TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending','approved','returned')), review_comment TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT,
    category TEXT NOT NULL DEFAULT 'Другое', review_checklist TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('team','organizer')),
    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT);
  CREATE TABLE workbook (team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(team_id, step_index));
  CREATE TABLE events (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, type TEXT NOT NULL, created_at TEXT NOT NULL);
`;

function seedLegacy(db, { withExpiry = true } = {}) {
  const iso = new Date().toISOString();
  db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('challenge-2026', 'school-sprint-2026', 'Сезон', 'Описание', 'LEGACY-CODE', iso, new Date(Date.now() + 7 * 86400000).toISOString(), 'active');
  db.prepare('INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo) VALUES (?, ?, ?, ?, ?, 0)').run('school-live', 'Живая школа', 'живая школа', 'KZ', 'Алматы');
  db.prepare('INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, created_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('team-live', 'challenge-2026', 'school-live', 'Живая команда', 'живая команда', 'Капитан', iso, iso);
  db.prepare('INSERT INTO steps VALUES (?, 1, ?)').run('team-live', iso);
  db.prepare('INSERT INTO workbook VALUES (?, 1, ?, ?)').run('team-live', 'Заметка, которую нельзя потерять при обновлении.', iso);
  db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('event-legacy', 'team-live', 'first_note', iso);
  if (withExpiry) db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('hashed-token', 'team', 'team-live', iso, new Date(Date.now() + 3600000).toISOString());
}

test('v0.2.0 database upgrades in place: teacher role, reminders, invites, data preserved', async t => {
  const file = tempDb(t);
  const legacy = new DatabaseSync(file);
  legacy.exec(V020);
  seedLegacy(legacy);
  legacy.close();

  const db = createDatabase(file, { seedDemo: false });
  t.after(() => db.close());
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get().sql;
  assert.match(sql, /'teacher'/);
  assert.ok(columns(db, 'sessions').includes('school_id'));
  assert.ok(columns(db, 'schools').includes('access_hash'));
  assert.ok(columns(db, 'schools').includes('coordinator_name'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invite_clicks'").get());
  assert.equal(db.prepare('SELECT COUNT(*) c FROM teams').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM challenges').get().c, 1);
  assert.match(db.prepare('SELECT content FROM workbook WHERE team_id=?').get('team-live').content, /нельзя потерять/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 1, 'valid hashed sessions survive the rebuild');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schools WHERE is_demo=1').get().c, 0, 'upgrade never invents demo rows');
  // The rebuilt CHECK really accepts the new role and still rejects nonsense.
  const iso = new Date().toISOString();
  db.prepare('INSERT INTO sessions (token, role, team_id, school_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?, ?)').run('teacher-token', 'teacher', 'school-live', iso, new Date(Date.now() + 3600000).toISOString());
  assert.throws(() => db.prepare('INSERT INTO sessions (token, role, created_at) VALUES (?, ?, ?)').run('bad-token', 'admin', iso));

  const app = createApp({ db, llm: createLlmAdapter(readLlmConfig({ LLM_ENABLED: 'false' })), demoMode: false, organizerPassword: 'upgrade-password-123' });
  const org = await request(app).post('/api/auth/organizer').send({ password: 'upgrade-password-123' }).expect(200);
  const cookie = org.headers['set-cookie'][0].split(';')[0];
  const issued = await request(app).post('/api/organizer/schools/school-live/coordinator').set('Cookie', cookie).send({ coordinatorName: 'Учитель' }).expect(201);
  const teacher = await request(app).post('/api/auth/teacher').send({ schoolId: 'school-live', coordinatorKey: issued.body.coordinatorKey }).expect(200);
  const cabinet = await request(app).get('/api/teacher').set('Cookie', teacher.headers['set-cookie'][0].split(';')[0]).expect(200);
  assert.equal(cabinet.body.teams[0].name, 'Живая команда');
});

test('the original MVP schema without expires_at still upgrades and forces a fresh login', t => {
  const file = tempDb(t);
  const legacy = new DatabaseSync(file);
  legacy.exec(V020.replace(', expires_at TEXT)', ')').replace(
    "category TEXT NOT NULL DEFAULT 'Другое', review_checklist TEXT NOT NULL DEFAULT '{}'", "category TEXT NOT NULL DEFAULT 'Другое'"));
  legacy.exec('CREATE TABLE sessions_old (token TEXT PRIMARY KEY);');
  seedLegacy(legacy, { withExpiry: false });
  legacy.close();

  const db = createDatabase(file, { seedDemo: false });
  t.after(() => db.close());
  assert.ok(columns(db, 'sessions').includes('expires_at'));
  assert.ok(columns(db, 'submissions').includes('review_checklist'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0, 'raw pre-hash tokens cannot be trusted');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM workbook').get().c, 1);
});

test('reopening an already migrated database is idempotent and reset keeps the live pilot', t => {
  const file = tempDb(t);
  const first = createDatabase(file, { seedDemo: true });
  const iso = new Date().toISOString();
  first.prepare('INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo) VALUES (?, ?, ?, ?, ?, 0)').run('school-live', 'Живая школа', 'живая школа', 'KZ', 'Алматы');
  first.prepare('INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('team-live', 'challenge-2026', 'school-live', 'Живая команда', 'живая команда', 'Капитан', iso);
  first.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('challenge-pilot', 'pilot-season', 'Пилот', 'Описание', 'PILOT-CODE', iso, new Date(Date.now() + 86400000).toISOString(), 'active');
  first.close();

  const db = createDatabase(file, { seedDemo: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) c FROM teams').get().c, 7, 'reopening does not re-seed');
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get().sql;
  const result = resetDemoData(db);
  assert.equal(result.seededTeams, 6);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get().sql, before);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM teams').get().c, 7);
  assert.ok(db.prepare('SELECT id FROM teams WHERE id=?').get('team-live'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM challenges').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reminders').get().c, 1);
  const again = createDatabase(file, { seedDemo: true });
  assert.equal(again.prepare('SELECT COUNT(*) c FROM teams').get().c, 7);
  again.close();
});
