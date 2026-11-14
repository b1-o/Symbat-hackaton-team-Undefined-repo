import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_CHALLENGE_ID = 'challenge-2026';
export const DEMO_SCHOOL_ID = 'school-kz-demo';
export const DEMO_TEAM_ID = 'team-eduquest';

const FINAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    access_code TEXT NOT NULL UNIQUE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    is_demo INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    normalized_city TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    UNIQUE(country_code, normalized_name, normalized_city, is_demo)
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
    last_activity_at TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
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
    role TEXT NOT NULL CHECK(role IN ('team', 'teacher', 'organizer')),
    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL REFERENCES challenges(id),
    school_id TEXT NOT NULL REFERENCES schools(id),
    message TEXT NOT NULL,
    created_by_role TEXT NOT NULL CHECK(created_by_role IN ('teacher', 'organizer')),
    created_at TEXT NOT NULL,
    read_at TEXT
  );

  CREATE TABLE IF NOT EXISTS invite_clicks (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    from_school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_teams_challenge ON teams(challenge_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_challenge_status ON submissions(challenge_id, status);
  CREATE INDEX IF NOT EXISTS idx_reminders_team_read ON reminders(team_id, read_at);
  CREATE INDEX IF NOT EXISTS idx_invite_clicks_challenge ON invite_clicks(challenge_id);
`;

function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql || '';
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db) {
  db.exec(FINAL_SCHEMA);

  addColumn(db, 'challenges', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'teams', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'teams', 'last_activity_at', 'TEXT');

  if (!hasColumn(db, 'schools', 'normalized_city')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE schools_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          country_code TEXT NOT NULL,
          city TEXT NOT NULL DEFAULT '',
          normalized_city TEXT NOT NULL DEFAULT '',
          is_demo INTEGER NOT NULL DEFAULT 0,
          UNIQUE(country_code, normalized_name, normalized_city, is_demo)
        );
        INSERT INTO schools_new (id, name, normalized_name, country_code, city, normalized_city, is_demo)
        SELECT id, name, normalized_name, country_code, city, lower(city), is_demo FROM schools;
        DROP TABLE schools;
        ALTER TABLE schools_new RENAME TO schools;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  if (!tableSql(db, 'sessions').includes('teacher')) {
    db.exec('DROP TABLE IF EXISTS sessions');
    db.exec(`
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('team', 'teacher', 'organizer')),
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  db.prepare("UPDATE challenges SET is_demo = 1 WHERE id = ? AND slug = 'school-sprint-2026'").run(DEMO_CHALLENGE_ID);
  db.prepare('UPDATE teams SET is_demo = 1 WHERE challenge_id = ?').run(DEMO_CHALLENGE_ID);
  db.exec('UPDATE teams SET last_activity_at = COALESCE(last_activity_at, started_at, created_at) WHERE last_activity_at IS NULL');
  db.exec('UPDATE schools SET normalized_city = lower(city) WHERE normalized_city = \'\'');
}

function iso(day, hour = 9) {
  return `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

function seedDemo(db) {
  const insertChallenge = db.prepare(`
    INSERT INTO challenges (id, slug, title, description, access_code, starts_at, ends_at, status, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)
  `);
  const insertSchool = db.prepare(`
    INSERT INTO schools (id, name, normalized_name, country_code, city, normalized_city, is_demo)
    VALUES (?, ?, ?, ?, ?, lower(?), 1)
  `);
  const insertTeam = db.prepare(`
    INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, last_activity_at, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)
  `);
  const insertStep = db.prepare('INSERT INTO steps (team_id, step_index, completed_at) VALUES (?, ?, ?)');
  const insertSubmission = db.prepare(`
    INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, review_comment, is_demo, created_at, updated_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?)
  `);
  const insertReminder = db.prepare(`
    INSERT INTO reminders (id, team_id, challenge_id, school_id, message, created_by_role, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, 'teacher', ?, NULL)
  `);
  const insertClick = db.prepare('INSERT INTO invite_clicks (id, challenge_id, from_school_id, created_at) VALUES (?, ?, ?, ?)');

  insertChallenge.run(
    DEMO_CHALLENGE_ID,
    'school-sprint-2026',
    '7 дней: от проблемы моей школы к стартап-проекту',
    'Командный спринт поверх AI Startify: пройдите путь от идеи до публикации и представьте школу в международном рейтинге.',
    'SPRINT-2026',
    iso(14),
    iso(21)
  );

  insertSchool.run('school-kz-demo', 'Демо-лицей №1', 'демо-лицей №1', 'KZ', 'Алматы', 'Алматы');
  insertSchool.run('school-uz-demo', 'Демо-школа №2', 'демо-школа №2', 'UZ', 'Ташкент', 'Ташкент');
  insertSchool.run('school-kg-demo', 'Демо-гимназия', 'демо-гимназия', 'KG', 'Бишкек', 'Бишкек');

  insertTeam.run('team-ecoschool', DEMO_CHALLENGE_ID, 'school-kz-demo', 'EcoSchool', 'ecoschool', 'Аружан', iso(14), iso(14), iso(15));
  insertTeam.run(DEMO_TEAM_ID, DEMO_CHALLENGE_ID, 'school-kz-demo', 'EduQuest', 'eduquest', 'Данияр', iso(14), iso(14), iso(14));
  insertTeam.run('team-smartcampus', DEMO_CHALLENGE_ID, 'school-uz-demo', 'SmartCampus', 'smartcampus', 'Азиз', iso(14), iso(14), iso(15));
  insertTeam.run('team-techbridge', DEMO_CHALLENGE_ID, 'school-uz-demo', 'TechBridge', 'techbridge', 'Малика', iso(14), iso(14), iso(15));
  insertTeam.run('team-greenfuture', DEMO_CHALLENGE_ID, 'school-kg-demo', 'GreenFuture', 'greenfuture', 'Айпери', iso(14), iso(14), iso(15));
  insertTeam.run('team-studylab', DEMO_CHALLENGE_ID, 'school-kg-demo', 'StudyLab', 'studylab', 'Бекзат', iso(14), iso(14), iso(14));

  for (const [teamId, completed] of [
    ['team-ecoschool', 5],
    [DEMO_TEAM_ID, 2],
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
    'sub-demo-ecoschool', 'team-ecoschool', DEMO_CHALLENGE_ID,
    'Демо · EcoTrack', 'https://aistartify.com/', 'demo:sub-demo-ecoschool',
    'Учебный пример проекта школьной команды. Это демо-запись, а не реальный паспорт AI Startify.',
    'approved', iso(14), iso(15), iso(15)
  );
  insertSubmission.run(
    'sub-demo-techbridge', 'team-techbridge', DEMO_CHALLENGE_ID,
    'Демо · StudyBridge', 'https://aistartify.com/', 'demo:sub-demo-techbridge',
    'Учебный пример проекта школьной команды. Это демо-запись, а не реальный паспорт AI Startify.',
    'approved', iso(14), iso(15), iso(15)
  );
  insertSubmission.run(
    'sub-demo-smartcampus', 'team-smartcampus', DEMO_CHALLENGE_ID,
    'Демо · CampusLoop', 'https://aistartify.com/startup/demo-smartcampus', 'https://aistartify.com/startup/demo-smartcampus',
    'Демо-заявка для показа очереди проверки организатором.',
    'pending', iso(15), iso(15), null
  );
  insertSubmission.run(
    'sub-demo-greenfuture', 'team-greenfuture', DEMO_CHALLENGE_ID,
    'Демо · GreenFuture', 'https://aistartify.com/startup/demo-greenfuture', 'https://aistartify.com/startup/demo-greenfuture',
    'Демо-заявка для показа очереди проверки организатором.',
    'pending', iso(15), iso(15), null
  );

  insertReminder.run(
    'reminder-demo-eduquest', DEMO_TEAM_ID, DEMO_CHALLENGE_ID, 'school-kz-demo',
    'Проверьте проблему с одним потенциальным пользователем и отметьте следующий шаг. Если нужна помощь — напишите учителю.',
    iso(14, 12)
  );

  insertClick.run('invite-click-demo-1', DEMO_CHALLENGE_ID, 'school-kz-demo', iso(14, 10));
  insertClick.run('invite-click-demo-2', DEMO_CHALLENGE_ID, 'school-kz-demo', iso(14, 11));
  insertClick.run('invite-click-demo-3', DEMO_CHALLENGE_ID, 'school-uz-demo', iso(14, 12));
}

function ensureDemoSeed(db) {
  const exists = db.prepare('SELECT id FROM challenges WHERE id = ?').get(DEMO_CHALLENGE_ID);
  if (exists) return;
  db.exec('BEGIN');
  try {
    seedDemo(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetDemoData(db) {
  db.exec('BEGIN');
  try {
    const demoChallenges = db.prepare('SELECT id FROM challenges WHERE is_demo = 1').all();
    for (const challenge of demoChallenges) {
      db.prepare('DELETE FROM invite_clicks WHERE challenge_id = ?').run(challenge.id);
      db.prepare('DELETE FROM teams WHERE challenge_id = ?').run(challenge.id);
      db.prepare('DELETE FROM challenges WHERE id = ?').run(challenge.id);
    }
    db.exec(`
      DELETE FROM schools
      WHERE is_demo = 1
        AND NOT EXISTS (SELECT 1 FROM teams WHERE teams.school_id = schools.id)
    `);
    seedDemo(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(dbPath) {
  const resolved = dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'startify.db');
  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  ensureDemoSeed(db);
  return db;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const db = openDatabase();
  console.log(`Database ready: ${db.prepare('SELECT COUNT(*) AS c FROM challenges').get().c} challenge(s)`);
  db.close();
}
