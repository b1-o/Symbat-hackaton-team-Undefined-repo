import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resetDemoData, DEMO_SCHOOL_ID, DEMO_TEAM_ID } from './db.js';
import {
  COUNTRIES, STEPS, DEFAULT_REMINDER, cleanText, countryName,
  normalizePassportUrl, median, hoursBetween, attentionReason, challengeSlug
} from './lib.js';

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}-${randomUUID()}`;

export async function createApp({ db, root = process.cwd(), isProduction = false, frontend = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));

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
    return db.prepare('SELECT token, role, team_id, school_id FROM sessions WHERE token = ?').get(token) || null;
  }

  function setSession(res, req, { role, teamId = null, schoolId = null }) {
    const oldToken = parseCookies(req).ss_session;
    if (oldToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(oldToken);
    const token = randomUUID();
    db.prepare('INSERT INTO sessions (token, role, team_id, school_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(token, role, teamId, schoolId, now());
    res.setHeader('Set-Cookie', `ss_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  }

  function resolveChallenge(ref) {
    if (ref) {
      const value = cleanText(String(ref), 120);
      const found = db.prepare('SELECT * FROM challenges WHERE id = ? OR slug = ?').get(value, value);
      if (found) return found;
      return null;
    }
    return db.prepare("SELECT * FROM challenges WHERE status = 'active' ORDER BY is_demo DESC, starts_at DESC, id LIMIT 1").get()
      || db.prepare('SELECT * FROM challenges ORDER BY starts_at DESC, id LIMIT 1').get()
      || null;
  }

  function challengeFromRequest(req) {
    return resolveChallenge(req.query?.challenge || req.body?.challengeId || req.body?.challenge || '');
  }

  function requireChallenge(req, res, next) {
    const challenge = challengeFromRequest(req);
    if (!challenge) return fail(res, 404, 'Челлендж не найден.');
    req.challenge = challenge;
    next();
  }

  function isOpen(challenge) {
    return challenge.status === 'active' && new Date(challenge.ends_at).getTime() >= Date.now();
  }

  function requireTeam(req, res, next) {
    const session = getSession(req);
    if (!session || session.role !== 'team' || !session.team_id) return fail(res, 401, 'Войдите как команда.');
    req.session = session;
    next();
  }

  function requireTeacher(req, res, next) {
    const session = getSession(req);
    if (!session || session.role !== 'teacher' || !session.school_id) return fail(res, 401, 'Откройте роль учителя.');
    req.session = session;
    next();
  }

  function requireOrganizer(req, res, next) {
    const session = getSession(req);
    if (!session || session.role !== 'organizer') return fail(res, 401, 'Откройте роль организатора.');
    req.session = session;
    next();
  }

  function requireStaff(req, res, next) {
    const session = getSession(req);
    if (!session || !['teacher', 'organizer'].includes(session.role)) return fail(res, 401, 'Нужна роль учителя или организатора.');
    if (session.role === 'teacher' && !session.school_id) return fail(res, 401, 'Учитель не привязан к школе.');
    req.session = session;
    next();
  }

  function touchTeam(teamId) {
    db.prepare('UPDATE teams SET last_activity_at = ? WHERE id = ?').run(now(), teamId);
  }

  function teamDetail(teamId) {
    const team = db.prepare(`
      SELECT t.*, s.name AS school_name, s.city AS school_city, s.country_code, s.is_demo AS school_is_demo,
             c.title AS challenge_title, c.slug AS challenge_slug, c.ends_at, c.status AS challenge_status, c.is_demo AS challenge_is_demo
      FROM teams t
      JOIN schools s ON s.id = t.school_id
      JOIN challenges c ON c.id = t.challenge_id
      WHERE t.id = ?
    `).get(teamId);
    if (!team) return null;

    const steps = db.prepare('SELECT step_index, completed_at FROM steps WHERE team_id = ? ORDER BY step_index').all(teamId);
    const submission = db.prepare('SELECT * FROM submissions WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1').get(teamId) || null;
    const reminders = db.prepare('SELECT id, message, created_by_role, created_at, read_at FROM reminders WHERE team_id = ? AND read_at IS NULL ORDER BY created_at DESC').all(teamId);
    const completed = steps.map((step) => step.step_index);
    const nextStep = STEPS.find((step) => !completed.includes(step.index))?.index || 5;

    return {
      id: team.id,
      name: team.name,
      nickname: team.nickname,
      isDemo: Boolean(team.is_demo),
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
        endsAt: team.ends_at,
        status: team.challenge_status,
        isDemo: Boolean(team.challenge_is_demo)
      },
      createdAt: team.created_at,
      startedAt: team.started_at,
      lastActivityAt: team.last_activity_at,
      referredBySchoolId: team.referred_by_school_id,
      steps: STEPS.map((step) => ({ ...step, completed: completed.includes(step.index) })),
      nextStep,
      submission,
      reminders
    };
  }

  function leaderboard(challengeId) {
    const schools = db.prepare(`
      SELECT s.id, s.name, s.city, s.country_code, s.is_demo,
             COUNT(DISTINCT t.id) AS teams,
             COUNT(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.id END) AS verified
      FROM teams t
      JOIN schools s ON s.id = t.school_id
      LEFT JOIN submissions sub ON sub.team_id = t.id AND sub.challenge_id = t.challenge_id
      WHERE t.challenge_id = ?
      GROUP BY s.id
      ORDER BY verified DESC, teams DESC, s.name ASC
    `).all(challengeId);

    const countries = db.prepare(`
      SELECT s.country_code,
             COUNT(DISTINCT s.id) AS schools,
             COUNT(DISTINCT t.id) AS teams,
             COUNT(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.id END) AS verified
      FROM teams t
      JOIN schools s ON s.id = t.school_id
      LEFT JOIN submissions sub ON sub.team_id = t.id AND sub.challenge_id = t.challenge_id
      WHERE t.challenge_id = ?
      GROUP BY s.country_code
      ORDER BY verified DESC, teams DESC, s.country_code ASC
    `).all(challengeId);

    return {
      schools: schools.map((row, index) => ({ ...row, rank: index + 1, countryName: countryName(row.country_code), isDemo: Boolean(row.is_demo) })),
      countries: countries.map((row, index) => ({ ...row, rank: index + 1, countryName: countryName(row.country_code) }))
    };
  }

  function publicProjects(challengeId) {
    return db.prepare(`
      SELECT sub.id, sub.title, sub.url, sub.description, sub.is_demo, sub.reviewed_at,
             t.name AS team_name, s.name AS school_name, s.country_code, s.city
      FROM submissions sub
      JOIN teams t ON t.id = sub.team_id
      JOIN schools s ON s.id = t.school_id
      WHERE sub.status = 'approved' AND sub.challenge_id = ?
      ORDER BY sub.reviewed_at DESC, sub.created_at DESC
      LIMIT 12
    `).all(challengeId).map((row) => ({ ...row, isDemo: Boolean(row.is_demo), countryName: countryName(row.country_code) }));
  }

  function stats(challengeId) {
    return db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) AS teams,
        COUNT(DISTINCT t.school_id) AS schools,
        COUNT(DISTINCT s.country_code) AS countries,
        COUNT(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.id END) AS verified
      FROM teams t
      JOIN schools s ON s.id = t.school_id
      LEFT JOIN submissions sub ON sub.team_id = t.id AND sub.challenge_id = t.challenge_id
      WHERE t.challenge_id = ?
    `).get(challengeId);
  }

  function bootstrap(challenge) {
    if (!challenge) return null;
    return {
      challenge,
      challenges: db.prepare('SELECT id, slug, title, status, is_demo, starts_at, ends_at FROM challenges ORDER BY is_demo DESC, starts_at DESC, id').all(),
      countries: COUNTRIES,
      steps: STEPS,
      stats: stats(challenge.id),
      leaderboard: leaderboard(challenge.id),
      projects: publicProjects(challenge.id),
      schools: db.prepare('SELECT id, name, city, country_code, is_demo FROM schools WHERE is_demo = ? ORDER BY name').all(challenge.is_demo),
      demoTeams: challenge.is_demo ? db.prepare(`
        SELECT t.id, t.name, s.name AS school_name, s.country_code
        FROM teams t JOIN schools s ON s.id = t.school_id
        WHERE t.challenge_id = ? AND t.is_demo = 1
        ORDER BY t.name
      `).all(challenge.id) : []
    };
  }

  function teamRows(challengeId, schoolId = null) {
    const sql = `
      SELECT t.id, t.name, t.nickname, t.created_at, t.started_at, t.last_activity_at, t.is_demo,
             s.id AS school_id, s.name AS school_name, s.city, s.country_code,
             (SELECT COUNT(*) FROM steps st WHERE st.team_id = t.id) AS steps_completed,
             sub.id AS submission_id, sub.title AS submission_title, sub.url AS submission_url,
             sub.status AS submission_status, sub.review_comment, sub.is_demo AS submission_is_demo,
             (SELECT COUNT(*) FROM reminders r WHERE r.team_id = t.id) AS reminders_sent,
             (SELECT COUNT(*) FROM reminders r WHERE r.team_id = t.id AND r.read_at IS NULL) AS reminders_unread
      FROM teams t
      JOIN schools s ON s.id = t.school_id
      LEFT JOIN submissions sub ON sub.id = (
        SELECT id FROM submissions WHERE team_id = t.id ORDER BY updated_at DESC LIMIT 1
      )
      WHERE t.challenge_id = ?
      ${schoolId ? 'AND t.school_id = ?' : ''}
      ORDER BY t.created_at DESC, t.name ASC
    `;
    const rows = schoolId ? db.prepare(sql).all(challengeId, schoolId) : db.prepare(sql).all(challengeId);
    return rows.map((row) => {
      const mapped = { ...row, countryName: countryName(row.country_code), isDemo: Boolean(row.is_demo), submissionIsDemo: Boolean(row.submission_is_demo) };
      mapped.attentionReason = attentionReason(mapped);
      return mapped;
    });
  }

  function funnelFor(challengeId, schoolId = null) {
    const where = schoolId ? 'WHERE challenge_id = ? AND school_id = ?' : 'WHERE challenge_id = ?';
    const args = schoolId ? [challengeId, schoolId] : [challengeId];
    const teamFunnel = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
      FROM teams ${where}
    `).get(...args);
    const subWhere = schoolId
      ? 'WHERE sub.challenge_id = ? AND t.school_id = ?'
      : 'WHERE sub.challenge_id = ?';
    const subArgs = schoolId ? [challengeId, schoolId] : [challengeId];
    const subFunnel = db.prepare(`
      SELECT COUNT(DISTINCT sub.team_id) AS submitted,
             SUM(CASE WHEN sub.status = 'approved' THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN sub.status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN sub.status = 'returned' THEN 1 ELSE 0 END) AS returned
      FROM submissions sub JOIN teams t ON t.id = sub.team_id ${subWhere}
    `).get(...subArgs);
    const total = teamFunnel.total || 0;
    const approved = subFunnel.approved || 0;
    const durations = db.prepare(`
      SELECT t.created_at, sub.reviewed_at
      FROM submissions sub JOIN teams t ON t.id = sub.team_id
      WHERE sub.status = 'approved' AND sub.challenge_id = ? ${schoolId ? 'AND t.school_id = ?' : ''}
    `).all(...subArgs).map((row) => hoursBetween(row.created_at, row.reviewed_at)).filter((value) => value !== null);
    return {
      total,
      started: teamFunnel.started || 0,
      submitted: subFunnel.submitted || 0,
      approved,
      pending: subFunnel.pending || 0,
      returned: subFunnel.returned || 0,
      conversion: total ? Math.round((approved / total) * 100) : 0,
      medianHoursToPublish: median(durations)
    };
  }

  function growthFor(challengeId, schoolId = null) {
    const clicks = schoolId
      ? db.prepare('SELECT COUNT(*) AS c FROM invite_clicks WHERE challenge_id = ? AND from_school_id = ?').get(challengeId, schoolId).c
      : db.prepare('SELECT COUNT(*) AS c FROM invite_clicks WHERE challenge_id = ?').get(challengeId).c;
    const referredTeams = schoolId
      ? db.prepare('SELECT COUNT(*) AS c FROM teams WHERE challenge_id = ? AND referred_by_school_id = ?').get(challengeId, schoolId).c
      : db.prepare('SELECT COUNT(*) AS c FROM teams WHERE challenge_id = ? AND referred_by_school_id IS NOT NULL').get(challengeId).c;
    const referredApproved = schoolId
      ? db.prepare(`
          SELECT COUNT(*) AS c FROM teams t JOIN submissions sub ON sub.team_id = t.id
          WHERE t.challenge_id = ? AND t.referred_by_school_id = ? AND sub.status = 'approved'
        `).get(challengeId, schoolId).c
      : db.prepare(`
          SELECT COUNT(*) AS c FROM teams t JOIN submissions sub ON sub.team_id = t.id
          WHERE t.challenge_id = ? AND t.referred_by_school_id IS NOT NULL AND sub.status = 'approved'
        `).get(challengeId).c;
    const reminders = schoolId
      ? db.prepare('SELECT COUNT(*) AS c FROM reminders WHERE challenge_id = ? AND school_id = ?').get(challengeId, schoolId).c
      : db.prepare('SELECT COUNT(*) AS c FROM reminders WHERE challenge_id = ?').get(challengeId).c;
    return { inviteClicks: clicks, referredTeams, referredApproved, remindersSent: reminders };
  }

  function pendingFor(challengeId, schoolId = null) {
    const sql = `
      SELECT sub.*, t.name AS team_name, s.name AS school_name, s.country_code, s.city
      FROM submissions sub
      JOIN teams t ON t.id = sub.team_id
      JOIN schools s ON s.id = t.school_id
      WHERE sub.status = 'pending' AND sub.challenge_id = ?
      ${schoolId ? 'AND t.school_id = ?' : ''}
      ORDER BY sub.created_at ASC
    `;
    const rows = schoolId ? db.prepare(sql).all(challengeId, schoolId) : db.prepare(sql).all(challengeId);
    return rows.map((row) => ({ ...row, isDemo: Boolean(row.is_demo), countryName: countryName(row.country_code) }));
  }

  function organizerData(challenge) {
    const teams = teamRows(challenge.id);
    return {
      challenge,
      funnel: funnelFor(challenge.id),
      growth: growthFor(challenge.id),
      teams,
      attention: teams.filter((team) => team.attentionReason),
      pending: pendingFor(challenge.id)
    };
  }

  function teacherData(challenge, schoolId) {
    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    if (!school) return null;
    const teams = teamRows(challenge.id, schoolId);
    return {
      challenge,
      school: { ...school, countryName: countryName(school.country_code), isDemo: Boolean(school.is_demo) },
      funnel: funnelFor(challenge.id, schoolId),
      growth: growthFor(challenge.id, schoolId),
      teams,
      attention: teams.filter((team) => team.attentionReason),
      pending: pendingFor(challenge.id, schoolId)
    };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'startify-sprint' }));

  app.get('/api/bootstrap', (req, res) => {
    const challenge = challengeFromRequest(req);
    if (!challenge) return fail(res, 404, 'Челлендж не найден.');
    res.json(bootstrap(challenge));
  });

  app.get('/api/me', (req, res) => {
    const session = getSession(req);
    if (!session) return res.json({ role: 'guest' });
    if (session.role === 'organizer') return res.json({ role: 'organizer' });
    if (session.role === 'teacher') {
      const school = db.prepare('SELECT id, name, city, country_code, is_demo FROM schools WHERE id = ?').get(session.school_id);
      if (!school) return res.json({ role: 'guest' });
      return res.json({ role: 'teacher', school: { ...school, countryName: countryName(school.country_code), isDemo: Boolean(school.is_demo) } });
    }
    const team = teamDetail(session.team_id);
    if (!team) return res.json({ role: 'guest' });
    return res.json({ role: 'team', team });
  });

  app.post('/api/demo/login', (req, res) => {
    const role = req.body?.role;
    if (role === 'organizer') {
      setSession(res, req, { role: 'organizer' });
      return res.json({ role: 'organizer' });
    }
    if (role === 'teacher') {
      const schoolId = cleanText(req.body?.schoolId, 120) || DEMO_SCHOOL_ID;
      const school = db.prepare('SELECT id FROM schools WHERE id = ?').get(schoolId);
      if (!school) return fail(res, 404, 'Школа не найдена.');
      setSession(res, req, { role: 'teacher', schoolId: school.id });
      return res.json({ role: 'teacher' });
    }
    if (role === 'team') {
      const teamId = cleanText(req.body?.teamId, 120) || DEMO_TEAM_ID;
      const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
      if (!team) return fail(res, 404, 'Демо-команда не найдена.');
      setSession(res, req, { role: 'team', teamId: team.id });
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

  app.post('/api/demo/reset', requireOrganizer, (_req, res) => {
    resetDemoData(db);
    const challenge = resolveChallenge('');
    res.json({ ok: true, bootstrap: bootstrap(challenge) });
  });

  app.post('/api/organizer/challenges', requireOrganizer, (req, res) => {
    const title = cleanText(req.body?.title, 160);
    const description = cleanText(req.body?.description, 1000);
    const accessCode = cleanText(req.body?.accessCode, 40).toUpperCase();
    const startsAt = cleanText(req.body?.startsAt, 40);
    const endsAt = cleanText(req.body?.endsAt, 40);
    if (title.length < 5) return fail(res, 400, 'Название челленджа слишком короткое.');
    if (!/^[A-Z0-9-]{4,40}$/.test(accessCode)) return fail(res, 400, 'Код приглашения: 4–40 символов, буквы/цифры/дефис.');
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return fail(res, 400, 'Укажите корректные даты начала и окончания.');
    }
    if (db.prepare('SELECT id FROM challenges WHERE access_code = ?').get(accessCode)) {
      return fail(res, 409, 'Такой код приглашения уже используется.');
    }
    let slug = challengeSlug(title);
    if (db.prepare('SELECT id FROM challenges WHERE slug = ?').get(slug)) slug = `${slug}-${randomUUID().slice(0, 8)}`;
    const id = newId('challenge');
    db.prepare(`
      INSERT INTO challenges (id, slug, title, description, access_code, starts_at, ends_at, status, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0)
    `).run(id, slug, title, description || 'Пилотный школьный спринт поверх AI Startify.', accessCode, start.toISOString(), end.toISOString());
    res.status(201).json({ challenge: db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) });
  });

  app.post('/api/teams', requireChallenge, (req, res) => {
    const challenge = req.challenge;
    if (!isOpen(challenge)) return fail(res, 409, 'Челлендж завершён или неактивен.');

    const accessCode = cleanText(req.body?.accessCode, 40).toUpperCase();
    if (accessCode !== challenge.access_code.toUpperCase()) return fail(res, 400, 'Неверный код приглашения.');

    const countryCode = cleanText(req.body?.countryCode, 2).toUpperCase();
    if (!COUNTRIES.some((country) => country.code === countryCode)) return fail(res, 400, 'Выберите страну из списка.');

    const schoolName = cleanText(req.body?.schoolName, 120);
    const city = cleanText(req.body?.city, 80);
    const teamName = cleanText(req.body?.teamName, 80);
    const nickname = cleanText(req.body?.nickname, 60);
    const fromSchoolId = cleanText(req.body?.fromSchoolId, 120) || null;

    if (schoolName.length < 2) return fail(res, 400, 'Укажите название школы.');
    if (teamName.length < 2) return fail(res, 400, 'Укажите название команды.');
    if (nickname.length < 1) return fail(res, 400, 'Укажите nickname участника.');

    if (fromSchoolId) {
      const referrer = db.prepare('SELECT id, is_demo FROM schools WHERE id = ?').get(fromSchoolId);
      if (!referrer || referrer.is_demo !== challenge.is_demo) return fail(res, 400, 'Школа-приглашающая не найдена в этом челлендже.');
    }

    const normalizedSchool = schoolName.toLowerCase();
    const normalizedCity = city.toLowerCase();
    let school = db.prepare(`
      SELECT * FROM schools WHERE country_code = ? AND normalized_name = ? AND normalized_city = ? AND is_demo = ?
    `).get(countryCode, normalizedSchool, normalizedCity, challenge.is_demo);

    if (!school) {
      const schoolId = newId('school');
      db.prepare('INSERT INTO schools (id, name, normalized_name, country_code, city, normalized_city, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(schoolId, schoolName, normalizedSchool, countryCode, city, normalizedCity, challenge.is_demo);
      school = { id: schoolId };
    }

    const normalizedTeam = teamName.toLowerCase();
    const existingTeam = db.prepare('SELECT id FROM teams WHERE challenge_id = ? AND school_id = ? AND normalized_name = ?')
      .get(challenge.id, school.id, normalizedTeam);
    if (existingTeam) return fail(res, 409, 'Такая команда уже есть в этой школе. Выберите другое название.');

    const teamId = newId('team');
    const timestamp = now();
    db.prepare(`
      INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, last_activity_at, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(teamId, challenge.id, school.id, teamName, normalizedTeam, nickname, fromSchoolId, timestamp, timestamp, challenge.is_demo);

    setSession(res, req, { role: 'team', teamId });
    res.status(201).json({ team: teamDetail(teamId) });
  });

  app.post('/api/invites/click', requireChallenge, (req, res) => {
    const fromSchoolId = cleanText(req.body?.fromSchoolId, 120);
    if (!fromSchoolId) return fail(res, 400, 'Не указана школа-приглашающая.');
    const school = db.prepare('SELECT id, is_demo FROM schools WHERE id = ?').get(fromSchoolId);
    if (!school || school.is_demo !== req.challenge.is_demo) return fail(res, 400, 'Школа-приглашающая не найдена.');
    db.prepare('INSERT INTO invite_clicks (id, challenge_id, from_school_id, created_at) VALUES (?, ?, ?, ?)')
      .run(newId('click'), req.challenge.id, fromSchoolId, now());
    res.status(201).json({ ok: true });
  });

  app.get('/api/team', requireTeam, (req, res) => {
    const team = teamDetail(req.session.team_id);
    if (!team) return fail(res, 404, 'Команда не найдена.');
    res.json({ team });
  });

  app.patch('/api/team/steps', requireTeam, (req, res) => {
    const team = db.prepare('SELECT t.*, c.ends_at, c.status FROM teams t JOIN challenges c ON c.id = t.challenge_id WHERE t.id = ?').get(req.session.team_id);
    if (!team) return fail(res, 404, 'Команда не найдена.');
    if (!isOpen(team)) return fail(res, 409, 'Челлендж завершён или неактивен.');
    const stepIndex = Number(req.body?.stepIndex);
    const completed = Boolean(req.body?.completed);
    if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > 4) {
      return fail(res, 400, 'Шаг 5 подтверждается только после проверки проекта организатором.');
    }
    const timestamp = now();
    if (completed) {
      db.prepare('INSERT OR IGNORE INTO steps (team_id, step_index, completed_at) VALUES (?, ?, ?)').run(team.id, stepIndex, timestamp);
      db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?), last_activity_at = ? WHERE id = ?').run(timestamp, timestamp, team.id);
    } else {
      db.prepare('DELETE FROM steps WHERE team_id = ? AND step_index = ?').run(team.id, stepIndex);
      touchTeam(team.id);
    }
    res.json({ team: teamDetail(team.id) });
  });

  app.post('/api/team/submission', requireTeam, (req, res) => {
    const team = db.prepare('SELECT t.*, c.ends_at, c.status FROM teams t JOIN challenges c ON c.id = t.challenge_id WHERE t.id = ?').get(req.session.team_id);
    if (!team) return fail(res, 404, 'Команда не найдена.');
    if (!isOpen(team)) return fail(res, 409, 'Челлендж завершён или неактивен.');

    const title = cleanText(req.body?.title, 120);
    const description = cleanText(req.body?.description, 1000);
    if (title.length < 2) return fail(res, 400, 'Укажите название проекта.');
    const normalized = normalizePassportUrl(req.body?.url);
    if (!normalized.ok) return fail(res, 400, normalized.error);

    const existing = db.prepare('SELECT * FROM submissions WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1').get(team.id);
    if (existing?.status === 'approved') return fail(res, 409, 'У команды уже есть подтверждённый проект в этом челлендже.');
    if (existing?.status === 'pending') return fail(res, 409, 'Проект уже на проверке.');
    const duplicate = db.prepare('SELECT id FROM submissions WHERE normalized_url = ? AND team_id <> ?').get(normalized.url, team.id);
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, NULL)
        `).run(newId('sub'), team.id, team.challenge_id, title, normalized.url, normalized.url, description, team.is_demo, timestamp, timestamp);
      }
      db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?), last_activity_at = ? WHERE id = ?').run(timestamp, timestamp, team.id);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return fail(res, 409, 'Эта ссылка уже используется.');
      throw error;
    }
    res.status(201).json({ team: teamDetail(team.id) });
  });

  app.post('/api/team/reminders/:id/read', requireTeam, (req, res) => {
    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id);
    if (!reminder || reminder.team_id !== req.session.team_id) return fail(res, 404, 'Напоминание не найдено.');
    db.prepare('UPDATE reminders SET read_at = ? WHERE id = ?').run(now(), reminder.id);
    touchTeam(req.session.team_id);
    res.json({ team: teamDetail(req.session.team_id) });
  });

  app.post('/api/teams/:id/reminder', requireStaff, (req, res) => {
    const team = db.prepare(`
      SELECT t.*, c.status, c.ends_at FROM teams t JOIN challenges c ON c.id = t.challenge_id WHERE t.id = ?
    `).get(req.params.id);
    if (!team) return fail(res, 404, 'Команда не найдена.');
    if (req.session.role === 'teacher' && req.session.school_id !== team.school_id) {
      return fail(res, 403, 'Учитель может напоминать только командам своей школы.');
    }
    const message = cleanText(req.body?.message, 500) || DEFAULT_REMINDER;
    db.prepare(`
      INSERT INTO reminders (id, team_id, challenge_id, school_id, message, created_by_role, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(newId('reminder'), team.id, team.challenge_id, team.school_id, message, req.session.role, now());
    res.status(201).json({ ok: true });
  });

  app.get('/api/organizer', requireOrganizer, requireChallenge, (req, res) => {
    res.json(organizerData(req.challenge));
  });

  app.get('/api/teacher', requireTeacher, requireChallenge, (req, res) => {
    const school = db.prepare('SELECT is_demo FROM schools WHERE id = ?').get(req.session.school_id);
    if (!school) return fail(res, 404, 'Школа не найдена.');
    if (school.is_demo !== req.challenge.is_demo) {
      return fail(res, 409, 'Эта роль учителя доступна только в челлендже своего типа данных.');
    }
    const data = teacherData(req.challenge, req.session.school_id);
    if (!data) return fail(res, 404, 'Школа не найдена.');
    res.json(data);
  });

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
      db.prepare('UPDATE teams SET started_at = COALESCE(started_at, ?), last_activity_at = ? WHERE id = ?').run(timestamp, timestamp, submission.team_id);
      return res.json({ ok: true });
    }

    if (decision === 'return') {
      if (comment.length < 3) return fail(res, 400, 'Добавьте комментарий для доработки.');
      db.prepare("UPDATE submissions SET status = 'returned', review_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
        .run(comment, timestamp, timestamp, submission.id);
      db.prepare('DELETE FROM steps WHERE team_id = ? AND step_index = 5').run(submission.team_id);
      touchTeam(submission.team_id);
      return res.json({ ok: true });
    }

    return fail(res, 400, 'Неизвестное решение.');
  });

  app.use('/api', (_req, res) => fail(res, 404, 'API-метод не найден.'));

  if (frontend) {
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
  }

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.parse.failed') return fail(res, 400, 'Некорректный JSON.');
    console.error(error);
    if (res.headersSent) return;
    fail(res, 500, 'Внутренняя ошибка сервера.');
  });

  return app;
}
