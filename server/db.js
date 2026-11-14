import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'startify.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    access_code TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    UNIQUE(country_code, normalized_name, city)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    school_id TEXT NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    nickname TEXT NOT NULL,
    referred_by_school_id TEXT REFERENCES schools(id),
    created_at TEXT NOT NULL,
    started_at TEXT,
    UNIQUE(challenge_id, school_id, normalized_name)
  );

  CREATE TABLE IF NOT EXISTS steps (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (team_id, step_index)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'returned')),
    review_comment TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('team', 'organizer')),
    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
`);

function iso(day) {
  return `2026-11-${String(day).padStart(2, '0')}T09:00:00.000Z`;
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM challenges').get().c;
  if (count > 0) return;

  const insertChallenge = db.prepare(`
    INSERT INTO challenges (id, slug, title, description, access_code, starts_at, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  const insertSchool = db.prepare(`
    INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const insertTeam = db.prepare(`
    INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const insertStep = db.prepare('INSERT INTO steps (team_id, step_index, completed_at) VALUES (?, ?, ?)');
  const insertSubmission = db.prepare(`
    INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, review_comment, is_demo, created_at, updated_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    insertChallenge.run(
      'challenge-2026',
      'school-sprint-2026',
      '7 дней: от проблемы моей школы к стартап-проекту',
      'Командный спринт поверх AI Startify: пройдите путь от идеи до публикации и представьте школу в международном рейтинге.',
      'SPRINT-2026',
      iso(14),
      iso(21)
    );

    insertSchool.run('school-kz-demo', 'Демо-лицей №1', 'демо-лицей №1', 'KZ', 'Алматы');
    insertSchool.run('school-uz-demo', 'Демо-школа №2', 'демо-школа №2', 'UZ', 'Ташкент');
    insertSchool.run('school-kg-demo', 'Демо-гимназия', 'демо-гимназия', 'KG', 'Бишкек');

    insertTeam.run('team-ecoschool', 'challenge-2026', 'school-kz-demo', 'EcoSchool', 'ecoschool', 'Аружан', iso(14), iso(14));
    insertTeam.run('team-eduquest', 'challenge-2026', 'school-kz-demo', 'EduQuest', 'eduquest', 'Данияр', iso(14), iso(14));
    insertTeam.run('team-smartcampus', 'challenge-2026', 'school-uz-demo', 'SmartCampus', 'smartcampus', 'Азиз', iso(14), iso(14));
    insertTeam.run('team-techbridge', 'challenge-2026', 'school-uz-demo', 'TechBridge', 'techbridge', 'Малика', iso(14), iso(14));
    insertTeam.run('team-greenfuture', 'challenge-2026', 'school-kg-demo', 'GreenFuture', 'greenfuture', 'Айпери', iso(14), iso(14));
    insertTeam.run('team-studylab', 'challenge-2026', 'school-kg-demo', 'StudyLab', 'studylab', 'Бекзат', iso(14), iso(14));

    for (const [teamId, completed] of [
      ['team-ecoschool', 5],
      ['team-eduquest', 2],
      ['team-smartcampus', 4],
      ['team-techbridge', 5],
      ['team-greenfuture', 4],
      ['team-studylab', 1]
    ]) {
      for (let step = 1; step <= completed; step += 1) {
        insertStep.run(teamId, step, iso(14 + Math.min(step, 6)));
      }
    }

    insertSubmission.run(
      'sub-demo-ecoschool', 'team-ecoschool', 'challenge-2026',
      'Демо · EcoTrack', 'https://aistartify.com/', 'demo:sub-demo-ecoschool',
      'Учебный пример проекта школьной команды. Это демо-запись, а не реальный паспорт AI Startify.',
      'approved', iso(14), iso(15), iso(15)
    );
    insertSubmission.run(
      'sub-demo-techbridge', 'team-techbridge', 'challenge-2026',
      'Демо · StudyBridge', 'https://aistartify.com/', 'demo:sub-demo-techbridge',
      'Учебный пример проекта школьной команды. Это демо-запись, а не реальный паспорт AI Startify.',
      'approved', iso(14), iso(15), iso(15)
    );
    insertSubmission.run(
      'sub-demo-smartcampus', 'team-smartcampus', 'challenge-2026',
      'Демо · CampusLoop', 'https://aistartify.com/startup/demo-smartcampus', 'https://aistartify.com/startup/demo-smartcampus',
      'Демо-заявка для показа очереди проверки организатором.',
      'pending', iso(15), iso(15), null
    );
    insertSubmission.run(
      'sub-demo-greenfuture', 'team-greenfuture', 'challenge-2026',
      'Демо · GreenFuture', 'https://aistartify.com/startup/demo-greenfuture', 'https://aistartify.com/startup/demo-greenfuture',
      'Демо-заявка для показа очереди проверки организатором.',
      'pending', iso(15), iso(15), null
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seed();
