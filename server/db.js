import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(filename = ':memory:', { seedDemo = true } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
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
      token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('team', 'organizer')),
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, created_at TEXT NOT NULL
    );
  `);
  const addColumn = (table, name, definition) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn('teams', 'access_hash', 'TEXT');
  addColumn('teams', 'consent_at', 'TEXT');
  addColumn('sessions', 'expires_at', 'TEXT');
  addColumn('submissions', 'category', "TEXT NOT NULL DEFAULT 'Другое'");
  addColumn('submissions', 'review_checklist', "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at, id);
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
    CREATE INDEX IF NOT EXISTS idx_teams_created ON teams(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_submissions_showcase ON submissions(status, reviewed_at, id);
    CREATE INDEX IF NOT EXISTS idx_schools_demo ON schools(is_demo, name);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_approved_team ON submissions(team_id) WHERE status = 'approved';
    DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  `);
  // Old raw-token sessions cannot be migrated to hashes; require a fresh login once.
  db.prepare('DELETE FROM sessions WHERE expires_at IS NULL').run();
  if (!db.prepare('SELECT COUNT(*) c FROM challenges').get().c) seed(db, seedDemo);
  return db;
}

function seed(db, includeDemo = true) {
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 86400000);
  const iso = start.toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'challenge-2026',
      'school-sprint-2026',
      '7 дней: от проблемы моей школы к стартап-проекту',
      'Командный спринт поверх AI Startify: от идеи до подтверждённой публикации.',
      process.env.CHALLENGE_ACCESS_CODE || 'SPRINT-2026',
      iso,
      end.toISOString(),
      'active',
    );
    if (!includeDemo) {
      db.exec('COMMIT');
      return;
    }
    const school = db.prepare('INSERT INTO schools VALUES (?, ?, ?, ?, ?, 1)');
    school.run('school-kz-demo', 'Демо-лицей №1', 'демо-лицей №1', 'KZ', 'Алматы');
    school.run('school-uz-demo', 'Демо-школа №2', 'демо-школа №2', 'UZ', 'Ташкент');
    school.run('school-kg-demo', 'Демо-гимназия', 'демо-гимназия', 'KG', 'Бишкек');
    const samples = [
      [
        'team-ecoschool',
        'school-kz-demo',
        'EcoSchool',
        'Аружан',
        4,
        'EcoTrack',
        'ClimateTech',
        'Прозрачный учёт раздельного сбора в школе: команды фиксируют результат и находят точки для улучшения.',
        'approved',
      ],
      ['team-eduquest', 'school-kz-demo', 'EduQuest', 'Данияр', 1, null, null, null, null],
      [
        'team-smartcampus',
        'school-uz-demo',
        'SmartCampus',
        'Азиз',
        4,
        'CampusLoop',
        'EdTech',
        'Обмен учебными материалами между классами с понятной навигацией и проверкой качества.',
        'pending',
      ],
      [
        'team-techbridge',
        'school-uz-demo',
        'TechBridge',
        'Малика',
        4,
        'StudyBridge',
        'EdTech',
        'Взаимное наставничество школьников: подбор учебных пар по теме и свободному времени.',
        'approved',
      ],
      [
        'team-greenfuture',
        'school-kg-demo',
        'GreenFuture',
        'Айпери',
        3,
        'GreenFuture',
        'ClimateTech',
        'Помощник школьного эко-клуба: план небольших экологических экспериментов и учёт результатов.',
        'pending',
      ],
      ['team-studylab', 'school-kg-demo', 'StudyLab', 'Бекзат', 0, null, null, null, null],
    ];
    for (const [id, schoolId, name, nickname, completed, title, category, description, status] of samples) {
      db.prepare(
        'INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        'challenge-2026',
        schoolId,
        name,
        name.toLowerCase(),
        nickname,
        schoolId === 'school-kg-demo' ? 'school-kz-demo' : null,
        iso,
        completed ? iso : null,
        iso,
      );
      for (let i = 1; i <= completed; i++) {
        const content = `${STORAGE_EXAMPLES[i - 1]} Учебный пример команды ${name}. Данные вымышлены и не являются результатом реального исследования.`;
        db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(id, i, iso);
        db.prepare('INSERT INTO workbook VALUES (?, ?, ?, ?)').run(id, i, content, iso);
      }
      if (status === 'approved') db.prepare('INSERT INTO steps VALUES (?, 5, ?)').run(id, iso);
      if (title) {
        const demoUrl =
          status === 'approved' && id === 'team-ecoschool'
            ? 'https://aistartify.com/'
            : `https://aistartify.com/startup/demo-${id}`;
        const normalized = demoUrl === 'https://aistartify.com/' ? `demo:${id}` : demoUrl;
        db.prepare(
          `INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, review_comment, is_demo, created_at, updated_at, reviewed_at, category, review_checklist)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        ).run(
          `sub-${id}`,
          id,
          'challenge-2026',
          title,
          demoUrl,
          normalized,
          description,
          status,
          status === 'approved' ? 'Демо-зачёт: пример интерфейса, не реальный проект AI Startify.' : '',
          iso,
          iso,
          status === 'approved' ? iso : null,
          category,
          '{}',
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
const STORAGE_EXAMPLES = [
  'Проблема: ученикам трудно понять, куда сдать батарейки. Пользователь: школьный эко-клуб. Сейчас объявления разрознены, информация быстро устаревает.',
  'Условный сценарий интервью: спросить трёх участников эко-клуба, как они собирают отходы. Здесь должны быть настоящие обезличенные ответы; пока это только план.',
  'MVP: карта школьных точек сбора и недельный чек-лист. Альтернатива: бумажный плакат. Проверить трудозатраты до выбора модели оплаты.',
  'Питч: мы помогаем школьному эко-клубу организовать раздельный сбор. Проблема, решение и следующий шаг описаны; цифры рынка пока не подтверждены.',
];
