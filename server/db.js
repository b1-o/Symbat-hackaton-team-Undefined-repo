import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(filename = ':memory:', { seedDemo = true } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
      access_code TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, country_code TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
      UNIQUE(country_code, normalized_name, city)
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id), school_id TEXT NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, nickname TEXT NOT NULL,
      referred_by_school_id TEXT REFERENCES schools(id), created_at TEXT NOT NULL, started_at TEXT,
      UNIQUE(challenge_id, school_id, normalized_name)
    );
    CREATE TABLE IF NOT EXISTS steps (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, step_index INTEGER NOT NULL,
      completed_at TEXT NOT NULL, PRIMARY KEY (team_id, step_index)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id), title TEXT NOT NULL, url TEXT NOT NULL,
      normalized_url TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'returned')),
      review_comment TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('team', 'organizer', 'teacher')),
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, created_at TEXT NOT NULL
    );
  `);
  const addColumn = (table, name, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn('teams', 'access_hash', 'TEXT');
  addColumn('teams', 'consent_at', 'TEXT');
  addColumn('sessions', 'expires_at', 'TEXT');
  addColumn('submissions', 'category', "TEXT NOT NULL DEFAULT 'Другое'");
  addColumn('submissions', 'review_checklist', "TEXT NOT NULL DEFAULT '{}'");
  addColumn('teams', 'verification_code', 'TEXT');
  addColumn('schools', 'access_hash', 'TEXT');
  addColumn('schools', 'coordinator_name', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'school_id', 'TEXT REFERENCES schools(id) ON DELETE CASCADE');
  // SQLite cannot ALTER a CHECK constraint: rebuild sessions once to admit the teacher role.
  const sessionsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get()?.sql || '';
  if (!sessionsSql.includes("'teacher'")) {
    db.exec(`
      CREATE TABLE sessions_v3 (
        token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('team', 'organizer', 'teacher')),
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, expires_at TEXT
      );
      INSERT INTO sessions_v3 (token, role, team_id, created_at, expires_at) SELECT token, role, team_id, created_at, expires_at FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_v3 RENAME TO sessions;
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      author_role TEXT NOT NULL CHECK(author_role IN ('teacher', 'organizer')),
      message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_verification ON teams(verification_code) WHERE verification_code IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_reminders_team ON reminders(team_id, read_at, created_at);
    CREATE TABLE IF NOT EXISTS invite_clicks (
      id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      visitor_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_clicks_school ON invite_clicks(school_id, created_at);
    CREATE TABLE IF NOT EXISTS workbook (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, step_index INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(team_id, step_index)
    );
    CREATE TABLE IF NOT EXISTS mentor_messages (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL, mode TEXT NOT NULL, source TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      type TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id, type, created_at);
    CREATE TABLE IF NOT EXISTS llm_calls (
      id TEXT PRIMARY KEY, team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      source TEXT NOT NULL, model TEXT, status TEXT NOT NULL, latency_ms INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_team_day ON llm_calls(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mentor_team_day ON mentor_messages(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_approved_team ON submissions(team_id) WHERE status = 'approved';
    DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  `);
  // Old raw-token sessions cannot be migrated to hashes; require a fresh login once.
  db.prepare('DELETE FROM sessions WHERE expires_at IS NULL').run();
  if (!db.prepare('SELECT COUNT(*) c FROM challenges').get().c) seed(db, seedDemo);
  // Teams created before ownership checks still need a code to put into their passport.
  const backfill = db.prepare('UPDATE teams SET verification_code=? WHERE id=?');
  for (const team of db.prepare('SELECT id FROM teams WHERE verification_code IS NULL').all()) backfill.run(uniqueVerificationCode(db), team.id);
  return db;
}

// Unambiguous alphabet: no O/0 or I/1, so a code can be read aloud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newVerificationCode() {
  return `SS-${Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}
function uniqueVerificationCode(db) {
  const exists = db.prepare('SELECT 1 FROM teams WHERE verification_code=?');
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = newVerificationCode();
    if (!exists.get(code)) return code;
  }
  throw new Error('Could not allocate a unique verification code.');
}
export { uniqueVerificationCode };

export const DEMO_CHALLENGE_ID = 'challenge-2026';
export const DEMO_SCHOOL_IDS = ['school-kz-demo', 'school-uz-demo', 'school-kg-demo'];

// Rebuilds only the rows labelled «Демо». Live pilot schools, teams and extra seasons survive.
export function resetDemoData(db) {
  const demoSchools = db.prepare('SELECT id FROM schools WHERE is_demo=1').all().map(r => r.id);
  const removedTeams = db.prepare('SELECT COUNT(*) c FROM teams WHERE school_id IN (SELECT id FROM schools WHERE is_demo=1)').get().c;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Live teams may carry a referral to a demo school: park it, then restore it if the same school is re-seeded.
    const parkedReferrals = db.prepare('SELECT id, referred_by_school_id FROM teams WHERE referred_by_school_id IN (SELECT id FROM schools WHERE is_demo=1)').all();
    db.prepare('UPDATE teams SET referred_by_school_id=NULL WHERE referred_by_school_id IN (SELECT id FROM schools WHERE is_demo=1)').run();
    db.prepare('DELETE FROM teams WHERE school_id IN (SELECT id FROM schools WHERE is_demo=1)').run();
    db.prepare('DELETE FROM invite_clicks WHERE school_id IN (SELECT id FROM schools WHERE is_demo=1)').run();
    db.prepare('DELETE FROM schools WHERE is_demo=1').run();
    seedChallenge(db);
    seedDemoRows(db);
    const restore = db.prepare('UPDATE teams SET referred_by_school_id=? WHERE id=? AND EXISTS(SELECT 1 FROM schools WHERE id=?)');
    for (const r of parkedReferrals) restore.run(r.referred_by_school_id, r.id, r.referred_by_school_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { removedTeams, removedSchools: demoSchools.length, seededTeams: samples().length };
}

function seed(db, includeDemo = true) {
  db.exec('BEGIN');
  try {
    seedChallenge(db);
    if (includeDemo) seedDemoRows(db);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function seedChallenge(db) {
  if (db.prepare('SELECT id FROM challenges WHERE id=?').get(DEMO_CHALLENGE_ID)) return;
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 86400000);
  db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(DEMO_CHALLENGE_ID, 'school-sprint-2026', '7 дней: от проблемы моей школы к стартап-проекту', 'Командный спринт поверх AI Startify: от идеи до подтверждённой публикации.', process.env.CHALLENGE_ACCESS_CODE || 'SPRINT-2026', start.toISOString(), end.toISOString(), 'active');
}

function samples() {
  return [
    ['team-ecoschool', 'school-kz-demo', 'EcoSchool', 'Аружан', 4, 'EcoTrack', 'ClimateTech', 'Прозрачный учёт раздельного сбора в школе: команды фиксируют результат и находят точки для улучшения.', 'approved'],
    ['team-eduquest', 'school-kz-demo', 'EduQuest', 'Данияр', 1, null, null, null, null],
    ['team-smartcampus', 'school-uz-demo', 'SmartCampus', 'Азиз', 4, 'CampusLoop', 'EdTech', 'Обмен учебными материалами между классами с понятной навигацией и проверкой качества.', 'pending'],
    ['team-techbridge', 'school-uz-demo', 'TechBridge', 'Малика', 4, 'StudyBridge', 'EdTech', 'Взаимное наставничество школьников: подбор учебных пар по теме и свободному времени.', 'approved'],
    ['team-greenfuture', 'school-kg-demo', 'GreenFuture', 'Айпери', 3, 'GreenFuture', 'ClimateTech', 'Помощник школьного эко-клуба: план небольших экологических экспериментов и учёт результатов.', 'pending'],
    ['team-studylab', 'school-kg-demo', 'StudyLab', 'Бекзат', 0, null, null, null, null]
  ];
}

function seedDemoRows(db) {
  const iso = new Date().toISOString();
  const school = db.prepare('INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo, coordinator_name) VALUES (?, ?, ?, ?, ?, 1, ?)');
  school.run('school-kz-demo', 'Демо-лицей №1', 'демо-лицей №1', 'KZ', 'Алматы', 'Демо-координатор');
  school.run('school-uz-demo', 'Демо-школа №2', 'демо-школа №2', 'UZ', 'Ташкент', 'Демо-координатор');
  school.run('school-kg-demo', 'Демо-гимназия', 'демо-гимназия', 'KG', 'Бишкек', 'Демо-координатор');
  for (const [id, schoolId, name, nickname, completed, title, category, description, status] of samples()) {
    db.prepare('INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, consent_at, verification_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, DEMO_CHALLENGE_ID, schoolId, name, name.toLowerCase(), nickname, schoolId === 'school-kg-demo' ? 'school-kz-demo' : null, iso, completed ? iso : null, iso, uniqueVerificationCode(db));
    for (let i = 1; i <= completed; i++) {
      const content = `${STORAGE_EXAMPLES[i - 1]} Учебный пример команды ${name}. Данные вымышлены и не являются результатом реального исследования.`;
      db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(id, i, iso);
      db.prepare('INSERT INTO workbook VALUES (?, ?, ?, ?)').run(id, i, content, iso);
    }
    if (status === 'approved') db.prepare('INSERT INTO steps VALUES (?, 5, ?)').run(id, iso);
    if (title) {
      // Demo passports keep the real URL shape but are explicitly labelled and never verified against the live site.
      const demoUrl = `https://aistartify.com/startup/demo-${id}`;
      db.prepare(`INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, review_comment, is_demo, created_at, updated_at, reviewed_at, category, review_checklist)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
        .run(`sub-${id}`, id, DEMO_CHALLENGE_ID, title, demoUrl, demoUrl, description, status, status === 'approved' ? 'Демо-зачёт: пример интерфейса, не реальный проект AI Startify.' : '', iso, iso, status === 'approved' ? iso : null, category, '{}');
    }
  }
  // Age two demo teams so the coordinator cabinet shows real stuck cases instead of an empty list.
  const stale = new Date(Date.now() - 3 * 86400000).toISOString();
  db.prepare("UPDATE teams SET created_at=?, started_at=? WHERE id='team-eduquest'").run(stale, stale);
  db.prepare("UPDATE workbook SET updated_at=? WHERE team_id='team-eduquest'").run(stale);
  db.prepare("UPDATE teams SET created_at=? WHERE id='team-studylab'").run(stale);
  db.prepare("INSERT INTO reminders (id, team_id, school_id, challenge_id, author_role, message, created_at) VALUES (?, ?, ?, ?, 'teacher', ?, ?)")
    .run('reminder-demo-1', 'team-eduquest', 'school-kz-demo', DEMO_CHALLENGE_ID, 'Демо-напоминание: на этапе 2 нужны три коротких интервью. Спросите одноклассников и запишите выводы без личных данных.', stale);
}
const STORAGE_EXAMPLES = [
  'Проблема: ученикам трудно понять, куда сдать батарейки. Пользователь: школьный эко-клуб. Сейчас объявления разрознены, информация быстро устаревает.',
  'Условный сценарий интервью: спросить трёх участников эко-клуба, как они собирают отходы. Здесь должны быть настоящие обезличенные ответы; пока это только план.',
  'MVP: карта школьных точек сбора и недельный чек-лист. Альтернатива: бумажный плакат. Проверить трудозатраты до выбора модели оплаты.',
  'Питч: мы помогаем школьному эко-клубу организовать раздельный сбор. Проблема, решение и следующий шаг описаны; цифры рынка пока не подтверждены.'
];
