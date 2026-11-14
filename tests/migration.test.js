import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, resetDemoData } from '../server/db.js';

test('migrates the original MVP schema without losing rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startify-migration-'));
  const dbPath = path.join(dir, 'old.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE challenges (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
      access_code TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE schools (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, country_code TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
      UNIQUE(country_code, normalized_name, city)
    );
    CREATE TABLE teams (
      id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id), school_id TEXT NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, nickname TEXT NOT NULL,
      referred_by_school_id TEXT REFERENCES schools(id), created_at TEXT NOT NULL, started_at TEXT,
      UNIQUE(challenge_id, school_id, normalized_name)
    );
    CREATE TABLE steps (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, step_index INTEGER NOT NULL,
      completed_at TEXT NOT NULL, PRIMARY KEY (team_id, step_index)
    );
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id), title TEXT NOT NULL, url TEXT NOT NULL,
      normalized_url TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'returned')),
      review_comment TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('team', 'organizer')),
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, created_at TEXT NOT NULL
    );
    INSERT INTO challenges VALUES ('challenge-2026','school-sprint-2026','Old demo','desc','SPRINT-2026','2026-11-14T09:00:00Z','2026-11-21T09:00:00Z','active');
    INSERT INTO schools VALUES ('school-old','Old School','old school','KZ','Almaty',1);
    INSERT INTO teams VALUES ('team-old','challenge-2026','school-old','Old Team','old team','Nick',NULL,'2026-11-14T09:00:00Z','2026-11-14T10:00:00Z');
    INSERT INTO submissions VALUES ('sub-old','team-old','challenge-2026','Old Project','https://aistartify.com/startup/old','https://aistartify.com/startup/old','','pending','',1,'2026-11-14T10:00:00Z','2026-11-14T10:00:00Z',NULL);
  `);
  old.close();

  const db = openDatabase(dbPath);
  try {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get('team-old');
    assert.equal(team.name, 'Old Team');
    assert.equal(team.is_demo, 1);
    assert.ok(team.last_activity_at);
    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get('school-old');
    assert.equal(school.normalized_city, 'almaty');
    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get('challenge-2026');
    assert.equal(challenge.is_demo, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE id = ?').get('sub-old').c, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    db.prepare(`INSERT INTO challenges (id, slug, title, description, access_code, starts_at, ends_at, status, is_demo)
                VALUES ('challenge-live','live-pilot','Live','desc','LIVE-TEST','2026-11-14T09:00:00Z','2026-12-01T09:00:00Z','active',0)`).run();
    resetDemoData(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM challenges WHERE id = ?').get('challenge-live').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM teams WHERE challenge_id = ?').get('challenge-2026').c, 6);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
