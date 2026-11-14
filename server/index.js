import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { COUNTRIES, STEPS, cleanText, countryName, normalizePassportUrl } from './lib.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const root = process.cwd();

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}-${randomUUID()}`;

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length === 2)
  );
}

function getSession(req) {
  const token = parseCookies(req).ss_session;
  if (!token) return null;
  return db.prepare('SELECT token, role, team_id FROM sessions WHERE token = ?').get(token) || null;
}

function setSession(res, req, role, teamId = null) {
  const oldToken = parseCookies(req).ss_session;
  if (oldToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(oldToken);
  const token = randomUUID();
  db.prepare('INSERT INTO sessions (token, role, team_id, created_at) VALUES (?, ?, ?, ?)').run(token, role, teamId, now());
  res.setHeader('Set-Cookie', `ss_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

function activeChallenge() {
  return db.prepare("SELECT * FROM challenges WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1").get();
}

function requireTeam(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'team' || !session.team_id) {
    return fail(res, 401, 'Войдите как команда.');
  }
  req.session = session;
  next();
}

function requireOrganizer(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'organizer') {
    return fail(res, 401, 'Откройте демо-роль организатора.');
  }
  req.session = session;
  next();
}

function teamDetail(teamId) {
  const team = db.prepare(`
    SELECT t.*, s.name AS school_name, s.city AS school_city, s.country_code, s.is_demo AS school_is_demo,
           c.title AS challenge_title, c.slug AS challenge_slug, c.ends_at
    FROM teams t
    JOIN schools s ON s.id = t.school_id
    JOIN challenges c ON c.id = t.challenge_id
    WHERE t.id = ?
  `).get(teamId);
  if (!team) return null;

  const steps = db.prepare('SELECT step_index, completed_at FROM steps WHERE team_id = ? ORDER BY step_index').all(teamId);
  const submission = db.prepare('SELECT * FROM submissions WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1').get(teamId) || null;
  const completed = steps.map((step) => step.step_index);
  const nextStep = STEPS.find((step) => !completed.includes(step.index))?.index || 5;

  return {
    id: team.id,
    name: team.name,
    nickname: team.nickname,
    school: {
      id: team.school_id,
      name: team.school_name,
      city: team.school_city,
      countryCode: team.country_code,
      countryName: countryName(team.country_code),
      isDemo: Boolean(team.school_is_demo)
    },
    challenge: {
      id: team.challenge_id,
      title: team.challenge_title,
      slug: team.challenge_slug,
      endsAt: team.ends_at
    },
    createdAt: team.created_at,
    startedAt: team.started_at,
    referredBySchoolId: team.referred_by_school_id,
    steps: STEPS.map((step) => ({ ...step, completed: completed.includes(step.index) })),
    nextStep,
    submission
  };
}

function leaderboard() {
  const schools = db.prepare(`
    SELECT s.id, s.name, s.city, s.country_code, s.is_demo,
           COUNT(DISTINCT t.id) AS teams,
           COUNT(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.id END) AS verified
    FROM schools s
    LEFT JOIN teams t ON t.school_id = s.id
    LEFT JOIN submissions sub ON sub.team_id = t.id
    GROUP BY s.id
    HAVING COUNT(DISTINCT t.id) > 0
    ORDER BY verified DESC, teams DESC, s.name ASC
  `).all();

  const countries = db.prepare(`
    SELECT s.country_code,
           COUNT(DISTINCT s.id) AS schools,
           COUNT(DISTINCT t.id) AS teams,
           COUNT(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.id END) AS verified
    FROM schools s
    LEFT JOIN teams t ON t.school_id = s.id
    LEFT JOIN submissions sub ON sub.team_id = t.id
    GROUP BY s.country_code
    HAVING COUNT(DISTINCT t.id) > 0
    ORDER BY verified DESC, teams DESC, s.country_code ASC
  `).all();

  return {
    schools: schools.map((row, index) => ({ ...row, rank: index + 1, countryName: countryName(row.country_code), isDemo: Boolean(row.is_demo) })),
    countries: countries.map((row, index) => ({ ...row, rank: index + 1, countryName: countryName(row.country_code) }))
  };
}

function publicProjects() {
  return db.prepare(`
    SELECT sub.id, sub.title, sub.url, sub.description, sub.is_demo, sub.reviewed_at,
           t.name AS team_name, s.name AS school_name, s.country_code, s.city
    FROM submissions sub
    JOIN teams t ON t.id = sub.team_id
    JOIN schools s ON s.id = t.school_id
    WHERE sub.status = 'approved'
    ORDER BY sub.reviewed_at DESC, sub.created_at DESC
    LIMIT 12
  `).all().map((row) => ({ ...row, isDemo: Boolean(row.is_demo), countryName: countryName(row.country_code) }));
}

function bootstrap() {
  const challenge = activeChallenge();
  const board = leaderboard();
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM teams) AS teams,
      (SELECT COUNT(DISTINCT school_id) FROM teams) AS schools,
      (SELECT COUNT(DISTINCT s.country_code) FROM teams t JOIN schools s ON s.id = t.school_id) AS countries,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved') AS verified
  `).get();

  return {
    challenge,
    countries: COUNTRIES,
    steps: STEPS,
    stats,
    leaderboard: board,
    projects: publicProjects(),
    schools: db.prepare('SELECT id, name, city, country_code FROM schools ORDER BY name').all(),
    demoTeams: db.prepare(`
      SELECT t.id, t.name, s.name AS school_name, s.country_code
      FROM teams t JOIN schools s ON s.id = t.school_id
      WHERE s.is_demo = 1
      ORDER BY t.name
    `).all()
  };
}

function organizerData() {
  const funnel = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM teams) AS total,
      (SELECT COUNT(*) FROM teams WHERE started_at IS NOT NULL) AS started,
      (SELECT COUNT(DISTINCT team_id) FROM submissions) AS submitted,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved') AS approved,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM submissions WHERE status = 'returned') AS returned
  `).get();

  const teams = db.prepare(`
    SELECT t.id, t.name, t.nickname, t.created_at, t.started_at,
           s.name AS school_name, s.city, s.country_code,
           (SELECT COUNT(*) FROM steps st WHERE st.team_id = t.id) AS steps_completed,
           sub.id AS submission_id, sub.title AS submission_title, sub.url AS submission_url,
           sub.status AS submission_status, sub.review_comment, sub.is_demo AS submission_is_demo
    FROM teams t
    JOIN schools s ON s.id = t.school_id
    LEFT JOIN submissions sub ON sub.id = (
      SELECT id FROM submissions WHERE team_id = t.id ORDER BY updated_at DESC LIMIT 1
    )
    ORDER BY t.created_at DESC, t.name ASC
  `).all().map((row) => ({ ...row, countryName: countryName(row.country_code), submissionIsDemo: Boolean(row.submission_is_demo) }));

  const pending = db.prepare(`
    SELECT sub.*, t.name AS team_name, s.name AS school_name, s.country_code, s.city
    FROM submissions sub
    JOIN teams t ON t.id = sub.team_id
    JOIN schools s ON s.id = t.school_id
    WHERE sub.status = 'pending'
    ORDER BY sub.created_at ASC
  `).all().map((row) => ({ ...row, isDemo: Boolean(row.is_demo), countryName: countryName(row.country_code) }));

  return {
    funnel: { ...funnel, conversion: funnel.total ? Math.round((funnel.approved / funnel.total) * 100) : 0 },
    teams,
    pending
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'startify-sprint' }));
app.get('/api/bootstrap', (_req, res) => res.json(bootstrap()));

app.get('/api/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ role: 'guest' });
  if (session.role === 'organizer') return res.json({ role: 'organizer' });
  const team = teamDetail(session.team_id);
  if (!team) return res.json({ role: 'guest' });
  return res.json({ role: 'team', team });
});

app.post('/api/demo/login', (req, res) => {
  const role = req.body?.role;
  if (role === 'organizer') {
    setSession(res, req, 'organizer');
    return res.json({ role: 'organizer' });
  }
  if (role === 'team') {
    const teamId = cleanText(req.body?.teamId, 120) || 'team-eduquest';
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) return fail(res, 404, 'Демо-команда не найдена.');
    setSession(res, req, 'team', team.id);
    return res.json({ role: 'team', team: teamDetail(team.id) });
  }
  return fail(res, 400, 'Неизвестная демо-роль.');
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).ss_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'ss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ role: 'guest' });
});

app.post('/api/teams', (req, res) => {
  const challenge = activeChallenge();
  if (!challenge) return fail(res, 409, 'Нет активного челленджа.');

  const accessCode = cleanText(req.body?.accessCode, 40).toUpperCase();
  if (accessCode !== challenge.access_code.toUpperCase()) {
    return fail(res, 400, 'Неверный код приглашения.');
  }

  const countryCode = cleanText(req.body?.countryCode, 2).toUpperCase();
  if (!COUNTRIES.some((country) => country.code === countryCode)) {
    return fail(res, 400, 'Выберите страну из списка.');
  }

  const schoolName = cleanText(req.body?.schoolName, 120);
  const city = cleanText(req.body?.city, 80);
  const teamName = cleanText(req.body?.teamName, 80);
  const nickname = cleanText(req.body?.nickname, 60);
  const fromSchoolId = cleanText(req.body?.fromSchoolId, 120) || null;

  if (schoolName.length < 2) return fail(res, 400, 'Укажите название школы.');
  if (teamName.length < 2) return fail(res, 400, 'Укажите название команды.');
  if (nickname.length < 1) return fail(res, 400, 'Укажите nickname участника.');
  if (fromSchoolId && !db.prepare('SELECT id FROM schools WHERE id = ?').get(fromSchoolId)) {
    return fail(res, 400, 'Школа-приглашающая не найдена.');
  }

  const normalizedSchool = schoolName.toLowerCase();
  let school = db.prepare('SELECT * FROM schools WHERE country_code = ? AND normalized_name = ? AND lower(city) = lower(?)')
    .get(countryCode, normalizedSchool, city);

  if (!school) {
    const schoolId = newId('school');
    db.prepare('INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
      .run(schoolId, schoolName, normalizedSchool, countryCode, city);
    school = { id: schoolId };
  }

  const normalizedTeam = teamName.toLowerCase();
  const existingTeam = db.prepare('SELECT id FROM teams WHERE challenge_id = ? AND school_id = ? AND normalized_name = ?')
    .get(challenge.id, school.id, normalizedTeam);
  if (existingTeam) return fail(res, 409, 'Такая команда уже есть в этой школе. Выберите другое название.');

  const teamId = newId('team');
  db.prepare(`
    INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(teamId, challenge.id, school.id, teamName, normalizedTeam, nickname, fromSchoolId, now());

  setSession(res, req, 'team', teamId);
  res.status(201).json({ team: teamDetail(teamId) });
});

app.get('/api/team', requireTeam, (req, res) => {
  const team = teamDetail(req.session.team_id);
  if (!team) return fail(res, 404, 'Команда не найдена.');
  res.json({ team });
});

app.patch('/api/team/steps', requireTeam, (req, res) => {
  const stepIndex = Number(req.body?.stepIndex);
  const completed = Boolean(req.body?.completed);
  if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > 4) {
    return fail(res, 400, 'Шаг 5 подтверждается только после проверки проекта организатором.');
  }

  if (completed) {
    db.prepare('INSERT OR IGNORE INTO steps (team_id, step_index, completed_at) VALUES (?, ?, ?)').run(req.session.team_id, stepIndex, now());
    db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?) WHERE id = ?').run(now(), req.session.team_id);
  } else {
    db.prepare('DELETE FROM steps WHERE team_id = ? AND step_index = ?').run(req.session.team_id, stepIndex);
  }

  res.json({ team: teamDetail(req.session.team_id) });
});

app.post('/api/team/submission', requireTeam, (req, res) => {
  const title = cleanText(req.body?.title, 120);
  const description = cleanText(req.body?.description, 1000);
  if (title.length < 2) return fail(res, 400, 'Укажите название проекта.');

  const normalized = normalizePassportUrl(req.body?.url);
  if (!normalized.ok) return fail(res, 400, normalized.error);

  const teamId = req.session.team_id;
  const existing = db.prepare('SELECT * FROM submissions WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1').get(teamId);
  if (existing?.status === 'approved') return fail(res, 409, 'У команды уже есть подтверждённый проект в этом челлендже.');
  if (existing?.status === 'pending') return fail(res, 409, 'Проект уже на проверке.');

  const duplicate = db.prepare('SELECT id FROM submissions WHERE normalized_url = ? AND team_id <> ?').get(normalized.url, teamId);
  if (duplicate) return fail(res, 409, 'Эта ссылка уже отправлена другой командой.');

  const timestamp = now();
  try {
    if (existing?.status === 'returned') {
      db.prepare(`
        UPDATE submissions
        SET title = ?, url = ?, normalized_url = ?, description = ?, status = 'pending', review_comment = '', updated_at = ?, reviewed_at = NULL
        WHERE id = ?
      `).run(title, normalized.url, normalized.url, description, timestamp, existing.id);
    } else {
      db.prepare(`
        INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, review_comment, is_demo, created_at, updated_at, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', 0, ?, ?, NULL)
      `).run(newId('sub'), teamId, existing?.challenge_id || activeChallenge().id, title, normalized.url, normalized.url, description, timestamp, timestamp);
    }
    db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?) WHERE id = ?').run(timestamp, teamId);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return fail(res, 409, 'Эта ссылка уже используется.');
    throw error;
  }

  res.status(201).json({ team: teamDetail(teamId) });
});

app.get('/api/organizer', requireOrganizer, (_req, res) => res.json(organizerData()));

app.post('/api/organizer/submissions/:id/review', requireOrganizer, (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return fail(res, 404, 'Заявка не найдена.');
  if (submission.status !== 'pending') return fail(res, 409, 'Проверять можно только заявки в статусе «На проверке».');

  const decision = req.body?.decision;
  const comment = cleanText(req.body?.comment, 500);
  const timestamp = now();

  if (decision === 'approve') {
    db.prepare("UPDATE submissions SET status = 'approved', review_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
      .run(comment, timestamp, timestamp, submission.id);
    db.prepare('INSERT OR IGNORE INTO steps (team_id, step_index, completed_at) VALUES (?, 5, ?)').run(submission.team_id, timestamp);
    db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?) WHERE id = ?').run(timestamp, submission.team_id);
    return res.json({ ok: true });
  }

  if (decision === 'return') {
    if (comment.length < 3) return fail(res, 400, 'Добавьте комментарий для доработки.');
    db.prepare("UPDATE submissions SET status = 'returned', review_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
      .run(comment, timestamp, timestamp, submission.id);
    db.prepare('DELETE FROM steps WHERE team_id = ? AND step_index = 5').run(submission.team_id);
    return res.json({ ok: true });
  }

  return fail(res, 400, 'Неизвестное решение.');
});

app.use('/api', (_req, res) => fail(res, 404, 'API-метод не найден.'));

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    root,
    server: { middlewareMode: true, hmr: false, allowedHosts: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  fail(res, 500, 'Внутренняя ошибка сервера.');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Startify Sprint listening on http://0.0.0.0:${port} (${isProduction ? 'production' : 'development'})`);
});
