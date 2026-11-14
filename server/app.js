import express from 'express';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { calculateMetrics } from './metrics.js';
import { contentSecurityPolicy } from './security.js';
import {
  COUNTRIES,
  CATEGORIES,
  STEPS,
  REMINDER_PRESETS,
  cleanText,
  countryName,
  normalizePassportUrl,
  safeCsvCell,
  attentionReason,
  challengeSlug,
  median,
  hoursBetween,
} from './lib.js';
import { resetDemoData, uniqueVerificationCode, DEMO_CHALLENGE_ID } from './db.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${randomUUID()}`;
const fail = (res, status, message, code) =>
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cookieOptions = (secure) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`;
function cookie(req, name) {
  const part = (req.headers.cookie || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}
function equalSecret(a, b) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function createApp({
  db,
  llm,
  demoMode = true,
  organizerPassword = '',
  inviteCode,
  secureCookies = false,
  appOrigin = '',
  development = false,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(development));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let same = false;
      try {
        same = new URL(req.headers.origin).host === req.get('host');
      } catch {
        /* reject malformed origin */
      }
      if (!same && req.headers.origin !== appOrigin)
        return fail(res, 403, 'Запрос с другого сайта запрещён.');
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const limiter = (max, windowMs = 60000) =>
    rateLimit({
      windowMs,
      limit: max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      handler: (_req, res) => fail(res, 429, 'Слишком много запросов. Подождите немного.'),
    });
  app.use('/api', (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      // Fixed API route labels: no query strings, cookies, notes or team identifiers in logs.
      const route = req.route
        ? req.baseUrl + (req.route.path === '/' ? '' : req.route.path)
        : req.path.split('/').slice(0, 3).join('/');
      console.info(
        JSON.stringify({
          event: 'http_request',
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - started),
          at: now(),
        }),
      );
    });
    next();
  });
  app.use('/api', limiter(300, 60000));
  const authLimiter = limiter(20, 15 * 60000);
  const mentorLimiter = limiter(30, 60000);
  const pendingMentor = new Map();
  const sessionCleanup = setInterval(
    () => db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now()),
    15 * 60000,
  );
  sessionCleanup.unref();
  app.locals.close = () => clearInterval(sessionCleanup);
  const record = (teamId, type) =>
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(id('event'), teamId, type, now());
  const activeChallenge = () =>
    db.prepare("SELECT * FROM challenges WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1").get();
  const challengeOpen = (c) =>
    Boolean(c) &&
    c.status === 'active' &&
    new Date(c.starts_at) <= new Date() &&
    new Date(c.ends_at) > new Date();
  const isOpen = (c = activeChallenge()) => challengeOpen(c);
  // A season can be addressed by id or slug; unknown and archived seasons never fall back silently.
  const resolveChallenge = (value) => {
    if (!value) return activeChallenge();
    const key = cleanText(value, 120);
    const c = db.prepare('SELECT * FROM challenges WHERE id=? OR slug=?').get(key, key);
    return c && c.status === 'active' ? c : null;
  };
  const publicChallenge = (c) => {
    if (!c) return null;
    const { access_code, ...rest } = c;
    return { ...rest, isOpen: challengeOpen(c) };
  };
  const listChallenges = () =>
    db.prepare('SELECT * FROM challenges ORDER BY starts_at DESC, id').all().map(publicChallenge);
  // The env override belongs to the original season only; every new season keeps its own code.
  const code = (c = activeChallenge()) =>
    inviteCode && c?.id === DEMO_CHALLENGE_ID ? inviteCode : c?.access_code;
  function session(req) {
    const token = cookie(req, 'ss_session');
    if (!token || token.length > 200) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(hash(token), now());
    return s || null;
  }
  function setSession(req, res, role, teamId = null, schoolId = null) {
    const previous = cookie(req, 'ss_session');
    if (previous) db.prepare('DELETE FROM sessions WHERE token = ?').run(hash(previous));
    const token = randomBytes(32).toString('base64url');
    db.prepare(
      'INSERT INTO sessions (token, role, team_id, school_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(hash(token), role, teamId, schoolId, now(), new Date(Date.now() + 86400000).toISOString());
    res.setHeader('Set-Cookie', `ss_session=${token}; ${cookieOptions(secureCookies)}`);
  }
  const requireTeam = (req, res, next) => {
    const s = session(req);
    if (!s || s.role !== 'team') return fail(res, 401, 'Войдите в команду.');
    req.session = s;
    next();
  };
  const requireOrganizer = (req, res, next) => {
    const s = session(req);
    if (!s || s.role !== 'organizer') return fail(res, 401, 'Нужен вход организатора.');
    req.session = s;
    next();
  };
  const requireTeacher = (req, res, next) => {
    const s = session(req);
    if (!s || s.role !== 'teacher' || !s.school_id) return fail(res, 401, 'Нужен вход координатора школы.');
    req.session = s;
    next();
  };
  function teamDetail(teamId) {
    const t = db
      .prepare(
        `SELECT t.*, s.name school_name, s.city school_city, s.country_code, s.is_demo school_is_demo,
      c.title challenge_title, c.ends_at FROM teams t JOIN schools s ON s.id=t.school_id JOIN challenges c ON c.id=t.challenge_id WHERE t.id=?`,
      )
      .get(teamId);
    if (!t) return null;
    const rows = db.prepare('SELECT * FROM steps WHERE team_id=?').all(teamId);
    const work = db.prepare('SELECT * FROM workbook WHERE team_id=?').all(teamId);
    const submission =
      db.prepare('SELECT * FROM submissions WHERE team_id=? ORDER BY updated_at DESC LIMIT 1').get(teamId) ||
      null;
    return {
      id: t.id,
      name: t.name,
      nickname: t.nickname,
      createdAt: t.created_at,
      startedAt: t.started_at,
      verificationCode: t.verification_code,
      isDemo: Boolean(t.school_is_demo),
      referredBySchoolId: t.referred_by_school_id,
      school: {
        id: t.school_id,
        name: t.school_name,
        city: t.school_city,
        countryCode: t.country_code,
        countryName: countryName(t.country_code),
        isDemo: Boolean(t.school_is_demo),
      },
      challenge: { id: t.challenge_id, title: t.challenge_title, endsAt: t.ends_at },
      reminders: db
        .prepare(
          'SELECT id, message, author_role, created_at, read_at FROM reminders WHERE team_id=? ORDER BY created_at DESC LIMIT 20',
        )
        .all(teamId)
        .map((r) => ({
          id: r.id,
          message: r.message,
          authorRole: r.author_role,
          createdAt: r.created_at,
          readAt: r.read_at,
        })),
      steps: STEPS.map((step) => ({
        ...step,
        completed: rows.some((r) => r.step_index === step.index),
        content: work.find((w) => w.step_index === step.index)?.content || '',
        updatedAt: work.find((w) => w.step_index === step.index)?.updated_at || null,
      })),
      nextStep: STEPS.find((step) => !rows.some((r) => r.step_index === step.index))?.index || 5,
      submission: submission ? { ...submission, is_demo: Boolean(submission.is_demo) } : null,
      xp: rows.length * 100,
    };
  }
  function leaderboard(challengeId = null) {
    const conditions = [],
      params = [];
    if (!demoMode) conditions.push('s.is_demo=0');
    if (challengeId) {
      conditions.push('t.challenge_id=?');
      params.push(challengeId);
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.city, s.country_code, s.is_demo,
      COUNT(DISTINCT t.id) teams, COUNT(DISTINCT CASE WHEN sub.status='approved' THEN sub.id END) verified
      FROM schools s JOIN teams t ON t.school_id=s.id LEFT JOIN submissions sub ON sub.team_id=t.id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} GROUP BY s.id ORDER BY verified DESC, teams DESC, s.name ASC`,
      )
      .all(...params);
    const countries = COUNTRIES.map((c) => {
      const schools = rows.filter((r) => r.country_code === c.code);
      return {
        country_code: c.code,
        countryName: c.name,
        flag: c.flag,
        schools: schools.length,
        teams: schools.reduce((n, r) => n + r.teams, 0),
        verified: schools.reduce((n, r) => n + r.verified, 0),
      };
    })
      .filter((r) => r.teams)
      .sort(
        (a, b) =>
          b.verified - a.verified || b.teams - a.teams || a.country_code.localeCompare(b.country_code),
      );
    return {
      schools: rows.map((r, i) => ({
        ...r,
        rank: i + 1,
        countryName: countryName(r.country_code),
        isDemo: Boolean(r.is_demo),
      })),
      countries: countries.map((r, i) => ({ ...r, rank: i + 1 })),
    };
  }
  function projects(challengeId = null, limit = 50) {
    return db
      .prepare(
        `SELECT sub.id, sub.title, sub.url, sub.description, sub.is_demo, sub.reviewed_at, sub.category,
      t.name team_name, s.name school_name, s.country_code, s.city FROM submissions sub JOIN teams t ON t.id=sub.team_id
      JOIN schools s ON s.id=t.school_id WHERE sub.status='approved' ${demoMode ? '' : 'AND s.is_demo=0'} ${challengeId ? 'AND sub.challenge_id=?' : ''} ORDER BY sub.reviewed_at DESC, sub.id ASC LIMIT ?`,
      )
      .all(...(challengeId ? [challengeId] : []), limit)
      .map((r) => ({ ...r, is_demo: Boolean(r.is_demo), countryName: countryName(r.country_code) }));
  }
  function organizerData(includeDemo = true, challengeId = null, limit = 50, offset = 0) {
    const conditions = [],
      scopeParams = [];
    if (!includeDemo) conditions.push('s.is_demo=0');
    if (challengeId) {
      conditions.push('t.challenge_id=?');
      scopeParams.push(challengeId);
    }
    const filter = conditions.length ? ' WHERE ' + conditions.join(' AND ') + ' ' : '';
    const teams = db
      .prepare(
        `SELECT t.id, t.name, t.nickname, t.created_at, t.started_at, t.referred_by_school_id, t.verification_code,
      s.name school_name, s.id school_id, s.country_code, s.is_demo,
      (SELECT COUNT(*) FROM steps st WHERE st.team_id=t.id) steps_completed,
      sub.id submission_id, sub.title submission_title, sub.status submission_status, sub.is_demo submission_is_demo
      FROM teams t JOIN schools s ON s.id=t.school_id
      LEFT JOIN submissions sub ON sub.id=(SELECT id FROM submissions WHERE team_id=t.id ORDER BY updated_at DESC LIMIT 1)
      ${filter} ORDER BY t.created_at DESC, t.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...scopeParams, limit + 1, offset);
    const pending = db
      .prepare(
        `SELECT sub.*, t.name team_name, t.verification_code, s.name school_name, s.country_code, s.is_demo school_is_demo
      FROM submissions sub JOIN teams t ON t.id=sub.team_id JOIN schools s ON s.id=t.school_id
      WHERE sub.status='pending' ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
      ORDER BY sub.created_at ASC, sub.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...scopeParams, limit + 1, offset);
    const evidence = db.prepare('SELECT step_index FROM steps WHERE team_id=?');
    const workbook = db.prepare(
      'SELECT step_index, content FROM workbook WHERE team_id=? ORDER BY step_index',
    );
    const metrics = calculateMetrics(db, includeDemo, challengeId);
    const inviteParams = [];
    if (challengeId) inviteParams.push(challengeId);
    if (!includeDemo) inviteParams.push(0);
    const reminderParams = [];
    if (!includeDemo) reminderParams.push(0);
    if (challengeId) reminderParams.push(challengeId);
    const result = {
      ...metrics,
      teams: teams.slice(0, limit).map((r) => ({
        ...r,
        is_demo: Boolean(r.is_demo),
        countryName: countryName(r.country_code),
        submissionIsDemo: Boolean(r.submission_is_demo),
      })),
      pending: pending.slice(0, limit).map((r) => ({
        ...r,
        is_demo: Boolean(r.is_demo),
        schoolIsDemo: Boolean(r.school_is_demo),
        countryName: countryName(r.country_code),
        steps: evidence.all(r.team_id).map((s) => s.step_index),
        workbook: workbook.all(r.team_id),
      })),
      page: {
        limit,
        offset,
        nextTeamsOffset: teams.length > limit ? offset + limit : null,
        nextPendingOffset: pending.length > limit ? offset + limit : null,
      },
      includeDemo,
      challengeId,
      invites: db
        .prepare(
          `SELECT COUNT(*) clicks, COUNT(DISTINCT visitor_hash) visitors FROM invite_clicks WHERE 1=1 ${challengeId ? 'AND challenge_id=?' : ''} ${!includeDemo ? 'AND (school_id IS NULL OR school_id IN (SELECT id FROM schools WHERE is_demo=?))' : ''}`,
        )
        .get(...inviteParams),
      reminders: db
        .prepare(
          `SELECT COUNT(*) sent, SUM(CASE WHEN r.read_at IS NOT NULL THEN 1 ELSE 0 END) read_count FROM reminders r JOIN teams t ON t.id=r.team_id JOIN schools s ON s.id=t.school_id WHERE 1=1 ${!includeDemo ? 'AND s.is_demo=?' : ''} ${challengeId ? 'AND t.challenge_id=?' : ''}`,
        )
        .get(...reminderParams),
      attention: teams
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          name: t.name,
          nickname: t.nickname,
          schoolId: t.school_id,
          schoolName: t.school_name,
          countryName: t.countryName,
          isDemo: t.is_demo,
          stepsCompleted: t.steps_completed,
          submissionStatus: t.submission_status,
          reason: attentionReason({
            stepsCompleted: t.steps_completed,
            startedAt: t.started_at,
            createdAt: t.created_at,
            lastActivityAt: db.prepare('SELECT MAX(created_at) t FROM events WHERE team_id=?').get(t.id).t,
            submissionStatus: t.submission_status,
          }),
        }))
        .filter((t) => t.reason)
        .sort((a, b) => a.reason.priority - b.reason.priority || a.name.localeCompare(b.name)),
    };
    result.reminders = {
      sent: result.reminders.sent,
      read: result.reminders.read_count || 0,
      presets: REMINDER_PRESETS,
    };
    return result;
  }
  // School-scoped view for a teacher/coordinator. Deliberately excludes pupils' workbook text.
  function teacherData(schoolId) {
    const school = db
      .prepare('SELECT id, name, city, country_code, is_demo, coordinator_name FROM schools WHERE id=?')
      .get(schoolId);
    if (!school) return null;
    const rows = db
      .prepare(
        `SELECT t.id, t.name, t.nickname, t.challenge_id, t.created_at, t.started_at, c.title challenge_title,
      (SELECT COUNT(*) FROM steps st WHERE st.team_id=t.id) steps_completed,
      (SELECT MAX(created_at) FROM events e WHERE e.team_id=t.id) last_activity_at,
      sub.status submission_status, sub.title submission_title, sub.url submission_url, sub.review_comment
      FROM teams t JOIN challenges c ON c.id=t.challenge_id
      LEFT JOIN submissions sub ON sub.id=(SELECT id FROM submissions WHERE team_id=t.id ORDER BY updated_at DESC LIMIT 1)
      WHERE t.school_id=? ORDER BY t.created_at DESC, t.name`,
      )
      .all(schoolId);
    const unread = db
      .prepare(
        'SELECT team_id, COUNT(*) c FROM reminders WHERE school_id=? AND read_at IS NULL GROUP BY team_id',
      )
      .all(schoolId);
    const sent = db
      .prepare(
        'SELECT team_id, COUNT(*) c, MAX(created_at) last_at FROM reminders WHERE school_id=? GROUP BY team_id',
      )
      .all(schoolId);
    const teams = rows.map((r) => {
      const shape = {
        stepsCompleted: r.steps_completed,
        startedAt: r.started_at,
        createdAt: r.created_at,
        lastActivityAt: r.last_activity_at,
        submissionStatus: r.submission_status,
      };
      return {
        id: r.id,
        name: r.name,
        nickname: r.nickname,
        challengeId: r.challenge_id,
        challengeTitle: r.challenge_title,
        createdAt: r.created_at,
        startedAt: r.started_at,
        lastActivityAt: r.last_activity_at,
        stepsCompleted: r.steps_completed,
        submissionStatus: r.submission_status,
        submissionTitle: r.submission_title,
        submissionUrl: r.submission_url,
        reviewComment: r.review_comment,
        idleHours:
          r.last_activity_at || r.started_at
            ? Math.floor(hoursBetween(r.last_activity_at || r.started_at) || 0)
            : null,
        unreadReminders: unread.find((u) => u.team_id === r.id)?.c || 0,
        remindersSent: sent.find((u) => u.team_id === r.id)?.c || 0,
        lastReminderAt: sent.find((u) => u.team_id === r.id)?.last_at || null,
        reason: attentionReason(shape),
      };
    });
    const attention = teams
      .filter((t) => t.reason)
      .sort((a, b) => a.reason.priority - b.reason.priority || a.name.localeCompare(b.name));
    const board = leaderboard();
    const rank = board.schools.find((s) => s.id === schoolId) || null;
    const clicks = db
      .prepare(
        'SELECT COUNT(*) total, COUNT(DISTINCT visitor_hash) visitors FROM invite_clicks WHERE school_id=?',
      )
      .get(schoolId);
    const funnel = {
      total: teams.length,
      started: teams.filter((t) => t.startedAt).length,
      submitted: teams.filter((t) => t.submissionStatus).length,
      approved: teams.filter((t) => t.submissionStatus === 'approved').length,
      pending: teams.filter((t) => t.submissionStatus === 'pending').length,
      returned: teams.filter((t) => t.submissionStatus === 'returned').length,
    };
    funnel.conversion = funnel.total ? +((funnel.approved / funnel.total) * 100).toFixed(1) : 0;
    return {
      school: {
        ...school,
        is_demo: Boolean(school.is_demo),
        countryName: countryName(school.country_code),
        hasCoordinatorKey: Boolean(
          db.prepare('SELECT access_hash FROM schools WHERE id=?').get(schoolId)?.access_hash,
        ),
      },
      teams,
      attention,
      funnel,
      rank,
      invites: {
        clicks: clicks.total,
        visitors: clicks.visitors,
        teamsFromInvite: db
          .prepare('SELECT COUNT(*) c FROM teams WHERE referred_by_school_id=?')
          .get(schoolId).c,
      },
      reminders: {
        sent: sent.reduce((n, r) => n + r.c, 0),
        unread: unread.reduce((n, r) => n + r.c, 0),
        presets: REMINDER_PRESETS,
      },
      schools: board.schools
        .filter((s) => s.id !== schoolId)
        .slice(0, 5)
        .map((s) => ({
          id: s.id,
          name: s.name,
          countryName: s.countryName,
          verified: s.verified,
          isDemo: s.isDemo,
        })),
    };
  }
  function issueCoordinatorKey(schoolId, coordinatorName) {
    const key = randomBytes(18).toString('base64url');
    db.prepare('UPDATE schools SET access_hash=?, coordinator_name=? WHERE id=?').run(
      hash(key),
      cleanText(coordinatorName, 60),
      schoolId,
    );
    return key;
  }
  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      service: 'startify-sprint',
      version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    }),
  );
  app.get('/api/bootstrap', (req, res) => {
    const selected = req.query.challenge ? resolveChallenge(req.query.challenge) : activeChallenge();
    if (req.query.challenge && !selected) return fail(res, 404, 'Сезон не найден или закрыт.');
    const c = selected || activeChallenge();
    const scope = req.query.challenge ? c.id : null;
    const all = organizerData(demoMode, scope);
    const board = leaderboard(scope);
    res.json({
      challenge: publicChallenge(c),
      challenges: listChallenges(),
      countries: COUNTRIES,
      categories: CATEGORIES,
      steps: STEPS,
      demoMode,
      inviteHint: demoMode ? code(c) : null,
      llm: llm.publicStatus(),
      stats: {
        teams: all.funnel.total,
        schools: board.schools.length,
        countries: board.countries.length,
        verified: all.funnel.approved,
      },
      leaderboard: board,
      projects: projects(scope),
      totalProjects: all.funnel.approved,
      schools: db
        .prepare(
          `SELECT id, name, city, country_code, is_demo FROM schools ${demoMode ? '' : 'WHERE is_demo=0'} ORDER BY name`,
        )
        .all(),
      demoTeams: demoMode
        ? db
            .prepare(
              'SELECT t.id, t.name FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.is_demo=1 ORDER BY t.name',
            )
            .all()
        : [],
      demoSchools: demoMode
        ? db.prepare('SELECT id, name, country_code FROM schools WHERE is_demo=1 ORDER BY name').all()
        : [],
    });
  });
  function pageOptions(req, res) {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000000
    ) {
      fail(res, 400, 'Пагинация: limit от 1 до 100, offset — неотрицательное целое число.');
      return null;
    }
    return { limit, offset };
  }
  app.get('/api/projects', (req, res) => {
    const page = pageOptions(req, res);
    if (!page) return;
    const selected = req.query.challenge ? resolveChallenge(req.query.challenge) : null;
    if (req.query.challenge && !selected) return fail(res, 404, 'Сезон не найден или закрыт.');
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200).toLowerCase() : '';
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const escape = (value) => value.replace(/[\\%_]/g, '\\$&');
    const rows = db
      .prepare(
        `SELECT sub.id, sub.title, sub.url, sub.description, sub.is_demo, sub.reviewed_at, sub.category,
      t.name team_name, s.name school_name, s.country_code, s.city FROM submissions sub
      JOIN teams t ON t.id=sub.team_id JOIN schools s ON s.id=t.school_id
      WHERE sub.status='approved' ${demoMode ? '' : 'AND s.is_demo=0'} ${selected ? 'AND sub.challenge_id=?' : ''}
      AND (?='' OR lower(sub.title || ' ' || sub.description || ' ' || t.name) LIKE ? ESCAPE '\\')
      AND (?='' OR s.country_code=?) AND (?='' OR sub.category=?)
      ORDER BY sub.reviewed_at DESC, sub.id ASC LIMIT ? OFFSET ?`,
      )
      .all(
        ...(selected ? [selected.id] : []),
        query,
        `%${escape(query)}%`,
        country,
        country,
        category,
        category,
        page.limit + 1,
        page.offset,
      );
    res.json({
      projects: rows
        .slice(0, page.limit)
        .map((r) => ({ ...r, is_demo: Boolean(r.is_demo), countryName: countryName(r.country_code) })),
      page: { ...page, nextOffset: rows.length > page.limit ? page.offset + page.limit : null },
    });
  });
  app.get('/api/me', (req, res) => {
    const s = session(req);
    if (!s) return res.json({ role: 'guest' });
    if (s.role === 'team') return res.json({ role: 'team', team: teamDetail(s.team_id) });
    if (s.role === 'teacher') {
      const school = db
        .prepare('SELECT id, name, country_code, is_demo FROM schools WHERE id=?')
        .get(s.school_id);
      if (!school) return res.json({ role: 'guest' });
      return res.json({
        role: 'teacher',
        school: {
          ...school,
          is_demo: Boolean(school.is_demo),
          countryName: countryName(school.country_code),
        },
      });
    }
    res.json({ role: 'organizer' });
  });
  app.post('/api/demo/login', authLimiter, (req, res) => {
    if (!demoMode) return fail(res, 404, 'Демо-вход отключён.');
    const role = req.body?.role;
    if (!['team', 'organizer', 'teacher'].includes(role)) return fail(res, 400, 'Неизвестная роль.');
    const teamId = role === 'team' ? cleanText(req.body?.teamId, 120) || 'team-eduquest' : null;
    const team =
      teamId &&
      db
        .prepare('SELECT t.id FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.id=? AND s.is_demo=1')
        .get(teamId);
    if (role === 'team' && !team) return fail(res, 404, 'Демо-команда не найдена.');
    let schoolId = null;
    if (role === 'teacher') {
      const requested = cleanText(req.body?.schoolId, 120);
      const school = requested
        ? db.prepare('SELECT id FROM schools WHERE id=? AND is_demo=1').get(requested)
        : db.prepare('SELECT id FROM schools WHERE is_demo=1 ORDER BY id').get();
      if (!school) return fail(res, 404, 'Демо-школа не найдена.');
      schoolId = school.id;
    }
    setSession(req, res, role, teamId, schoolId);
    res.json({ role, ...(teamId ? { team: teamDetail(teamId) } : {}), ...(schoolId ? { schoolId } : {}) });
  });
  app.post('/api/auth/teacher', authLimiter, (req, res) => {
    const schoolId = cleanText(req.body?.schoolId, 120),
      key = cleanText(req.body?.coordinatorKey, 100);
    const school = db.prepare('SELECT id, access_hash FROM schools WHERE id=?').get(schoolId);
    if (!school?.access_hash || !key || !equalSecret(hash(key), school.access_hash))
      return fail(res, 401, 'Неверный ID школы или ключ координатора.');
    setSession(req, res, 'teacher', null, school.id);
    res.json({ role: 'teacher', schoolId: school.id });
  });
  app.post('/api/auth/organizer', authLimiter, (req, res) => {
    if (!organizerPassword) return fail(res, 403, 'Вход организатора не настроен.');
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length > 200 || !equalSecret(password, organizerPassword))
      return fail(res, 401, 'Неверный пароль.');
    setSession(req, res, 'organizer');
    res.json({ role: 'organizer' });
  });
  app.post('/api/auth/team', authLimiter, (req, res) => {
    const teamId = cleanText(req.body?.teamId, 120),
      key = cleanText(req.body?.recoveryKey, 100);
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
    if (!t?.access_hash || !equalSecret(hash(key), t.access_hash))
      return fail(res, 401, 'Неверный ID команды или ключ восстановления.');
    setSession(req, res, 'team', t.id);
    res.json({ role: 'team', team: teamDetail(t.id) });
  });
  app.post('/api/logout', (req, res) => {
    const token = cookie(req, 'ss_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    res.setHeader(
      'Set-Cookie',
      `ss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`,
    );
    res.json({ role: 'guest' });
  });
  app.post('/api/teams', authLimiter, (req, res) => {
    const input = z
      .object({
        accessCode: z.string().max(80),
        countryCode: z.enum(COUNTRIES.map((c) => c.code)),
        schoolName: z.string().trim().min(2).max(120),
        city: z.string().trim().max(80).default(''),
        teamName: z.string().trim().min(2).max(80),
        nickname: z.string().trim().min(1).max(60),
        fromSchoolId: z.string().max(120).nullable().optional(),
        challengeId: z.string().max(120).optional(),
        consent: z.literal(true),
        ageConfirmed: z.literal(true),
      })
      .safeParse(req.body);
    if (!input.success)
      return fail(
        res,
        400,
        'Заполните поля команды и подтвердите возраст 13+ и правила обработки учебных данных.',
      );
    const f = input.data;
    const challenge = f.challengeId ? resolveChallenge(f.challengeId) : activeChallenge();
    if (!challenge) return fail(res, 404, 'Сезон не найден или закрыт.');
    if (!isOpen(challenge)) return fail(res, 409, 'Спринт ещё не начался или уже завершён.');
    if (!equalSecret(f.accessCode.toUpperCase(), code(challenge).toUpperCase()))
      return fail(res, 400, 'Неверный код приглашения.');
    const from =
      f.fromSchoolId && db.prepare('SELECT id FROM schools WHERE id=?').get(f.fromSchoolId)
        ? f.fromSchoolId
        : null;
    const normalized = f.schoolName.toLowerCase();
    const recoveryKey = randomBytes(18).toString('base64url');
    let teamId;
    db.exec('BEGIN IMMEDIATE');
    try {
      let school = db
        .prepare('SELECT * FROM schools WHERE country_code=? AND normalized_name=? AND lower(city)=lower(?)')
        .get(f.countryCode, normalized, f.city);
      if (!school) {
        const schoolId = id('school');
        db.prepare(
          'INSERT INTO schools (id, name, normalized_name, country_code, city, is_demo) VALUES (?, ?, ?, ?, ?, 0)',
        ).run(schoolId, f.schoolName, normalized, f.countryCode, f.city);
        school = { id: schoolId };
      }
      if (
        db
          .prepare('SELECT id FROM teams WHERE challenge_id=? AND school_id=? AND normalized_name=?')
          .get(challenge.id, school.id, f.teamName.toLowerCase())
      ) {
        db.exec('ROLLBACK');
        return fail(res, 409, 'Команда с таким названием уже есть. Войдите по ключу восстановления.');
      }
      teamId = id('team');
      db.prepare(
        'INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, access_hash, consent_at, verification_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
      ).run(
        teamId,
        challenge.id,
        school.id,
        f.teamName,
        f.teamName.toLowerCase(),
        f.nickname,
        from,
        now(),
        hash(recoveryKey),
        now(),
        uniqueVerificationCode(db),
      );
      record(teamId, 'team_created');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    setSession(req, res, 'team', teamId);
    res.status(201).json({ team: teamDetail(teamId), teamId, recoveryKey });
  });
  app.get('/api/team', requireTeam, (req, res) => res.json({ team: teamDetail(req.session.team_id) }));
  app.post('/api/team/reminders/:id/read', requireTeam, (req, res) => {
    const result = db
      .prepare('UPDATE reminders SET read_at=COALESCE(read_at, ?) WHERE id=? AND team_id=?')
      .run(now(), cleanText(req.params.id, 120), req.session.team_id);
    if (!result.changes) return fail(res, 404, 'Напоминание не найдено.');
    record(req.session.team_id, 'reminder_read');
    res.json({ team: teamDetail(req.session.team_id) });
  });
  // Counts an invite opening, not a person: the visitor hash rotates daily and no raw IP/user-agent is stored.
  app.post('/api/invite/click', limiter(60, 60000), (req, res) => {
    const schoolId = cleanText(req.body?.schoolId, 120) || null;
    const challenge = resolveChallenge(req.body?.challengeId);
    if (!challenge) return fail(res, 404, 'Сезон не найден или закрыт.');
    if (
      schoolId &&
      !db.prepare(`SELECT id FROM schools WHERE id=? ${demoMode ? '' : 'AND is_demo=0'}`).get(schoolId)
    )
      return fail(res, 404, 'Школа не найдена.');
    const day = now().slice(0, 10);
    const visitor = hash(`${day}|${req.ip || ''}|${req.get('user-agent') || ''}`);
    db.prepare('INSERT INTO invite_clicks VALUES (?, ?, ?, ?, ?)').run(
      id('click'),
      challenge.id,
      schoolId,
      visitor,
      now(),
    );
    res.status(201).json({ ok: true });
  });
  function saveWork(teamId, stepIndex, content) {
    const first = !db.prepare("SELECT id FROM events WHERE team_id=? AND type='first_note'").get(teamId);
    db.prepare(
      'INSERT INTO workbook VALUES (?, ?, ?, ?) ON CONFLICT(team_id, step_index) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at',
    ).run(teamId, stepIndex, content, now());
    db.prepare('UPDATE teams SET started_at=COALESCE(started_at, ?) WHERE id=?').run(now(), teamId);
    if (first && content.length) {
      record(teamId, 'first_note');
      record(teamId, 'activated');
    }
    record(teamId, 'activity');
  }
  app.patch('/api/team/workbook', requireTeam, (req, res) => {
    const stepIndex = Number(req.body?.stepIndex),
      content = req.body?.content;
    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 1 ||
      stepIndex > 4 ||
      typeof content !== 'string' ||
      content.length > 5000
    )
      return fail(res, 400, 'Некорректные заметки: этап 1–4, до 5000 символов.');
    const team = teamDetail(req.session.team_id);
    if (team.submission && ['pending', 'approved'].includes(team.submission.status))
      return fail(res, 409, 'Заметки зафиксированы на время проверки и после зачёта.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (['pending', 'approved'].includes(teamDetail(req.session.team_id).submission?.status)) {
        db.exec('ROLLBACK');
        return fail(res, 409, 'Проект уже на проверке. Изменения не сохранены.');
      }
      saveWork(req.session.team_id, stepIndex, content.trim());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ team: teamDetail(req.session.team_id) });
  });
  app.patch('/api/team/steps', requireTeam, (req, res) => {
    const teamId = req.session.team_id,
      team = teamDetail(teamId),
      index = Number(req.body?.stepIndex);
    if (!Number.isInteger(index) || index < 1 || index > 4)
      return fail(res, 400, 'Пятый этап подтверждает только организатор.');
    if (typeof req.body?.completed !== 'boolean') return fail(res, 400, 'Укажите статус этапа.');
    if (team.submission && ['pending', 'approved'].includes(team.submission.status))
      return fail(res, 409, 'Во время проверки и после зачёта этапы заблокированы.');
    const content =
      typeof req.body?.content === 'string' ? req.body.content.trim() : team.steps[index - 1].content;
    if (typeof content !== 'string' || content.length > 5000)
      return fail(res, 400, 'Заметки слишком длинные.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (['pending', 'approved'].includes(teamDetail(teamId).submission?.status)) {
        db.exec('ROLLBACK');
        return fail(res, 409, 'Проект уже на проверке. Изменения не сохранены.');
      }
      saveWork(teamId, index, content);
      if (req.body.completed) {
        if (content.length < 80) {
          db.exec('ROLLBACK');
          return fail(res, 400, 'Для зачёта этапа добавьте хотя бы 80 символов содержательных заметок.');
        }
        if (index > 1 && !team.steps[index - 2].completed) {
          db.exec('ROLLBACK');
          return fail(res, 409, 'Сначала завершите предыдущий этап.');
        }
        const inserted = db.prepare('INSERT OR IGNORE INTO steps VALUES (?, ?, ?)').run(teamId, index, now());
        if (inserted.changes) record(teamId, 'checkpoint_completed');
      } else {
        if (team.steps.slice(index).some((s) => s.completed)) {
          db.exec('ROLLBACK');
          return fail(res, 409, 'Сначала верните в работу более поздние этапы.');
        }
        db.prepare('DELETE FROM steps WHERE team_id=? AND step_index=?').run(teamId, index);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ team: teamDetail(teamId) });
  });
  app.post('/api/team/submission', limiter(12, 60000), requireTeam, (req, res) => {
    const team = teamDetail(req.session.team_id);
    if (!isOpen(db.prepare('SELECT * FROM challenges WHERE id=?').get(team.challenge.id)))
      return fail(res, 409, 'Приём проектов в этом сезоне завершён.');
    if (team.steps.slice(0, 4).some((s) => !s.completed))
      return fail(res, 409, 'Сначала завершите первые четыре этапа.');
    if (team.submission && ['pending', 'approved'].includes(team.submission.status))
      return fail(res, 409, 'Проект уже на проверке или подтверждён.');
    const title = cleanText(req.body?.title, 120),
      description = cleanText(req.body?.description, 1000),
      category = req.body?.category;
    if (title.length < 2 || description.length < 30 || !CATEGORIES.includes(category))
      return fail(res, 400, 'Укажите название, категорию и описание от 30 символов.');
    const normalized = normalizePassportUrl(req.body?.url);
    if (!normalized.ok) return fail(res, 400, normalized.error);
    if (
      db
        .prepare('SELECT id FROM submissions WHERE normalized_url=? AND team_id<>?')
        .get(normalized.url, team.id)
    )
      return fail(res, 409, 'Этот паспорт уже отправлен другой командой.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (team.submission?.status === 'returned')
        db.prepare(
          "UPDATE submissions SET title=?, url=?, normalized_url=?, description=?, category=?, status='pending', review_comment='', review_checklist='{}', updated_at=?, reviewed_at=NULL WHERE id=?",
        ).run(title, normalized.url, normalized.url, description, category, now(), team.submission.id);
      else
        db.prepare(
          "INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, created_at, updated_at, category, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
        ).run(
          id('sub'),
          team.id,
          team.challenge.id,
          title,
          normalized.url,
          normalized.url,
          description,
          now(),
          now(),
          category,
          team.isDemo ? 1 : 0,
        );
      record(team.id, team.submission?.status === 'returned' ? 'project_resubmitted' : 'project_submitted');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE')) return fail(res, 409, 'Этот паспорт уже используется.');
      throw error;
    }
    res.status(201).json({ team: teamDetail(team.id) });
  });
  app.get('/api/team/mentor', requireTeam, (req, res) => {
    const messages = db
      .prepare(
        'SELECT * FROM (SELECT id, step_index, mode, source, content, created_at FROM mentor_messages WHERE team_id=? ORDER BY created_at DESC, id DESC LIMIT 30) ORDER BY created_at ASC, id ASC',
      )
      .all(req.session.team_id)
      .map((m) => ({ ...m, result: JSON.parse(m.content) }));
    res.json({ messages });
  });
  app.post(
    '/api/team/mentor',
    mentorLimiter,
    requireTeam,
    asyncRoute(async (req, res) => {
      const parsed = z
        .object({
          stepIndex: z.number().int().min(1).max(4),
          mode: z.enum(['guide', 'review', 'draft', 'pitch']),
          message: z.string().max(1500).default(''),
          language: z.enum(['ru', 'en']).default('ru'),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) return fail(res, 400, 'Некорректный запрос наставнику.');
      const teamId = req.session.team_id,
        team = teamDetail(teamId),
        input = parsed.data;
      if (llm.publicStatus().enabled) {
        const count = db
          .prepare('SELECT COUNT(*) c FROM llm_calls WHERE team_id=? AND created_at>?')
          .get(teamId, new Date(Date.now() - 86400000).toISOString()).c;
        if (count + (pendingMentor.get(teamId) || 0) >= 40)
          return fail(
            res,
            429,
            'Лимит 40 обращений к модели в сутки. Шаблоны и заметки доступны без ограничений.',
            'llm_quota',
          );
      }
      pendingMentor.set(teamId, (pendingMentor.get(teamId) || 0) + 1);
      const started = Date.now();
      let result;
      try {
        result = await llm.generate({
          ...input,
          workbook: Object.fromEntries(team.steps.slice(0, 4).map((s) => [s.index, s.content])),
        });
      } catch (error) {
        if (!res.destroyed)
          db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)').run(
            id('call'),
            teamId,
            'llm',
            llm.publicStatus().model,
            'error',
            Date.now() - started,
            now(),
          );
        throw error;
      } finally {
        const left = pendingMentor.get(teamId) - 1;
        if (left) pendingMentor.set(teamId, left);
        else pendingMentor.delete(teamId);
      }
      if (res.destroyed) return;
      const latency = Date.now() - started;
      db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id('call'),
        teamId,
        result.source,
        result.model,
        'ok',
        latency,
        result.usage?.promptTokens || 0,
        result.usage?.completionTokens || 0,
        now(),
      );
      db.prepare('INSERT INTO mentor_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id('msg'),
        teamId,
        input.stepIndex,
        input.mode,
        result.source,
        JSON.stringify(result),
        now(),
      );
      res.json({ result, latency });
    }),
  );
  app.delete('/api/team/mentor', requireTeam, (req, res) => {
    db.prepare('DELETE FROM mentor_messages WHERE team_id=?').run(req.session.team_id);
    res.json({ ok: true });
  });
  app.delete('/api/team/data', requireTeam, (req, res) => {
    if (teamDetail(req.session.team_id)?.isDemo)
      return fail(
        res,
        409,
        'Общие демо-команды не удаляются. Удаление доступно для собственной пилотной команды.',
      );
    db.prepare('DELETE FROM teams WHERE id=?').run(req.session.team_id);
    res.setHeader(
      'Set-Cookie',
      `ss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });
  app.get('/api/teacher', requireTeacher, (req, res) => {
    const data = teacherData(req.session.school_id);
    if (!data) return fail(res, 404, 'Школа не найдена.');
    res.json(data);
  });
  app.post('/api/teacher/reminders', limiter(30, 60000), requireTeacher, (req, res) => {
    const parsed = z
      .object({ teamId: z.string().min(1).max(120), message: z.string().trim().min(5).max(400) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return fail(res, 400, 'Выберите команду и напишите напоминание от 5 до 400 символов.');
    const team = db
      .prepare('SELECT id, school_id, challenge_id FROM teams WHERE id=?')
      .get(parsed.data.teamId);
    if (!team || team.school_id !== req.session.school_id)
      return fail(res, 404, 'Команда не относится к вашей школе.');
    const unread = db
      .prepare('SELECT COUNT(*) c FROM reminders WHERE team_id=? AND read_at IS NULL')
      .get(team.id).c;
    if (unread >= 3) return fail(res, 409, 'У команды уже три непрочитанных напоминания. Дождитесь ответа.');
    const today = db
      .prepare('SELECT COUNT(*) c FROM reminders WHERE school_id=? AND created_at>?')
      .get(req.session.school_id, new Date(Date.now() - 86400000).toISOString()).c;
    if (today >= 50) return fail(res, 429, 'Дневной лимит напоминаний школы исчерпан.');
    db.prepare('INSERT INTO reminders VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(
      id('reminder'),
      team.id,
      team.school_id,
      team.challenge_id,
      'teacher',
      parsed.data.message,
      now(),
    );
    res.status(201).json(teacherData(req.session.school_id));
  });
  app.post('/api/teacher/rotate-key', authLimiter, requireTeacher, (req, res) => {
    const school = db.prepare('SELECT coordinator_name FROM schools WHERE id=?').get(req.session.school_id);
    const coordinatorKey = issueCoordinatorKey(req.session.school_id, school?.coordinator_name || '');
    db.prepare("DELETE FROM sessions WHERE role='teacher' AND school_id=? AND token<>?").run(
      req.session.school_id,
      req.session.token,
    );
    res.json({ schoolId: req.session.school_id, coordinatorKey });
  });
  app.get('/api/organizer', requireOrganizer, (req, res) => {
    if (req.query.challenge && !resolveChallenge(req.query.challenge))
      return fail(res, 404, 'Сезон не найден или закрыт.');
    const page = pageOptions(req, res);
    if (!page) return;
    res.json(
      organizerData(
        req.query.includeDemo !== 'false',
        req.query.challenge ? resolveChallenge(req.query.challenge).id : null,
        page.limit,
        page.offset,
      ),
    );
  });
  app.post('/api/organizer/reminders', limiter(30, 60000), requireOrganizer, (req, res) => {
    const parsed = z
      .object({ teamId: z.string().min(1).max(120), message: z.string().trim().min(5).max(400) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return fail(res, 400, 'Выберите команду и напишите напоминание от 5 до 400 символов.');
    const team = db
      .prepare('SELECT id, school_id, challenge_id FROM teams WHERE id=?')
      .get(parsed.data.teamId);
    if (!team) return fail(res, 404, 'Команда не найдена.');
    if (
      db.prepare('SELECT COUNT(*) c FROM reminders WHERE team_id=? AND read_at IS NULL').get(team.id).c >= 3
    )
      return fail(res, 409, 'У команды уже три непрочитанных напоминания.');
    db.prepare('INSERT INTO reminders VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(
      id('reminder'),
      team.id,
      team.school_id,
      team.challenge_id,
      'organizer',
      parsed.data.message,
      now(),
    );
    res.status(201).json({ ok: true });
  });
  app.post('/api/organizer/schools/:id/coordinator', requireOrganizer, (req, res) => {
    const schoolId = cleanText(req.params.id, 120);
    const school = db.prepare('SELECT id, is_demo FROM schools WHERE id=?').get(schoolId);
    if (!school) return fail(res, 404, 'Школа не найдена.');
    if (school.is_demo && !demoMode) return fail(res, 409, 'Демо-школа недоступна в пилотном режиме.');
    const coordinatorKey = issueCoordinatorKey(schoolId, req.body?.coordinatorName);
    db.prepare("DELETE FROM sessions WHERE role='teacher' AND school_id=?").run(schoolId);
    res.status(201).json({ schoolId, coordinatorKey });
  });
  app.get('/api/organizer/schools', requireOrganizer, (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.city, s.country_code, s.is_demo, s.coordinator_name, s.access_hash,
      (SELECT COUNT(*) FROM teams t WHERE t.school_id=s.id) teams,
      (SELECT COUNT(*) FROM submissions sub JOIN teams t ON t.id=sub.team_id WHERE t.school_id=s.id AND sub.status='approved') verified
      FROM schools s ${demoMode ? '' : 'WHERE s.is_demo=0'} ORDER BY s.name`,
      )
      .all();
    res.json({
      schools: rows.map(({ access_hash, ...r }) => ({
        ...r,
        is_demo: Boolean(r.is_demo),
        countryName: countryName(r.country_code),
        hasCoordinatorKey: Boolean(access_hash),
      })),
    });
  });
  app.post('/api/organizer/challenges', requireOrganizer, (req, res) => {
    const parsed = z
      .object({
        title: z.string().trim().min(5).max(120),
        description: z.string().trim().max(400).default(''),
        days: z.number().int().min(1).max(60).default(7),
        accessCode: z.string().trim().min(6).max(80).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return fail(res, 400, 'Укажите название сезона (от 5 символов) и длительность 1–60 дней.');
    const f = parsed.data;
    const base = challengeSlug(f.title);
    let slug = base,
      suffix = 2;
    while (db.prepare('SELECT id FROM challenges WHERE slug=?').get(slug)) slug = `${base}-${suffix++}`;
    const challengeId = id('challenge');
    const start = new Date();
    const accessCode =
      f.accessCode || `${base.slice(0, 12).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      challengeId,
      slug,
      f.title,
      f.description || 'Школьный спринт поверх AI Startify: от идеи до подтверждённой публикации.',
      accessCode,
      start.toISOString(),
      new Date(start.getTime() + f.days * 86400000).toISOString(),
      'active',
    );
    res.status(201).json({
      challenge: publicChallenge(db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId)),
      accessCode,
      challenges: listChallenges(),
    });
  });
  app.patch('/api/organizer/challenges/:id', requireOrganizer, (req, res) => {
    const challengeId = cleanText(req.params.id, 120);
    const challenge = db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId);
    if (!challenge) return fail(res, 404, 'Сезон не найден.');
    const status = req.body?.status;
    if (!['active', 'archived'].includes(status))
      return fail(res, 400, 'Статус сезона: active или archived.');
    if (
      status === 'archived' &&
      db.prepare("SELECT COUNT(*) c FROM challenges WHERE status='active'").get().c <= 1
    )
      return fail(res, 409, 'Нельзя закрыть последний активный сезон.');
    db.prepare('UPDATE challenges SET status=? WHERE id=?').run(status, challengeId);
    res.json({
      challenge: publicChallenge(db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId)),
      challenges: listChallenges(),
    });
  });
  app.post('/api/demo/reset', requireOrganizer, (_req, res) => {
    if (!demoMode) return fail(res, 404, 'Сброс демо доступен только в демо-режиме.');
    // Sessions of removed demo teams disappear via ON DELETE CASCADE; live pilot sessions stay valid.
    res.json({ ok: true, ...resetDemoData(db) });
  });
  app.get('/api/organizer/export.csv', requireOrganizer, (req, res) => {
    const scope = req.query.challenge ? resolveChallenge(req.query.challenge) : null;
    if (req.query.challenge && !scope) return fail(res, 404, 'Сезон не найден или закрыт.');
    const rows = [
      ['Команда', 'Школа', 'Страна', 'Этапы', 'Статус', 'Демо', 'Создана', 'Нужна помощь', 'Код владения'],
    ];
    for (let offset = 0; ; offset += 100) {
      const data = organizerData(req.query.includeDemo !== 'false', scope?.id || null, 100, offset);
      rows.push(
        ...data.teams.map((t) => [
          t.name,
          t.school_name,
          t.countryName,
          t.steps_completed,
          t.submission_status || 'new',
          t.is_demo ? 'да' : 'нет',
          t.created_at,
          data.attention.find((a) => a.id === t.id)?.reason.label || '',
          t.verification_code || '',
        ]),
      );
      if (data.page.nextTeamsOffset === null) break;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="startify-funnel.csv"');
    res.send('\uFEFF' + rows.map((r) => r.map(safeCsvCell).join(',')).join('\r\n'));
  });
  app.post(
    '/api/organizer/llm/test',
    requireOrganizer,
    asyncRoute(async (_req, res) => {
      if (!llm.publicStatus().enabled)
        return fail(res, 409, 'LLM_ENABLED=false. Настройте серверный адаптер.');
      const start = Date.now();
      const result = await llm.generate({
        stepIndex: 1,
        mode: 'guide',
        message: 'Ответь одним коротким вопросом о проблеме школьника.',
        workbook: {},
        language: 'ru',
      });
      res.json({ ok: true, model: result.model, latency: Date.now() - start, usage: result.usage || null });
    }),
  );
  app.post('/api/organizer/submissions/:id/review', requireOrganizer, (req, res) => {
    const sub = db.prepare('SELECT * FROM submissions WHERE id=?').get(req.params.id);
    if (!sub) return fail(res, 404, 'Заявка не найдена.');
    const decision = req.body?.decision,
      comment = cleanText(req.body?.comment, 500);
    if (!['approve', 'return'].includes(decision)) return fail(res, 400, 'Неизвестное решение.');
    if (decision === 'return' && comment.length < 3)
      return fail(res, 400, 'Объясните, что нужно доработать.');
    const checklist = req.body?.checklist;
    const owner = db
      .prepare('SELECT s.is_demo FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.id=?')
      .get(sub.team_id);
    // A demo passport does not exist, so ownership cannot be proven for it; a real one must carry the team code.
    const required = ['accessible', 'original', 'safe', 'complete', ...(owner?.is_demo ? [] : ['ownership'])];
    if (decision === 'approve' && (!checklist || required.some((k) => checklist[k] !== true)))
      return fail(
        res,
        400,
        owner?.is_demo
          ? 'Подтвердите все четыре пункта ручной проверки.'
          : 'Подтвердите все пункты проверки, включая код команды в паспорте.',
      );
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT status FROM submissions WHERE id=?').get(sub.id).status !== 'pending') {
        db.exec('ROLLBACK');
        return fail(res, 409, 'Заявка уже проверена.');
      }
      db.prepare(
        'UPDATE submissions SET status=?, review_comment=?, review_checklist=?, reviewed_at=?, updated_at=? WHERE id=?',
      ).run(
        decision === 'approve' ? 'approved' : 'returned',
        comment,
        JSON.stringify(decision === 'approve' ? Object.fromEntries(required.map((k) => [k, true])) : {}),
        now(),
        now(),
        sub.id,
      );
      record(sub.team_id, decision === 'approve' ? 'project_approved' : 'project_returned');
      db.prepare('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?)').run(
        id('audit'),
        'submission_review',
        sub.id,
        JSON.stringify({
          decision,
          comment,
          checklist: decision === 'approve' ? Object.fromEntries(required.map((k) => [k, true])) : {},
        }),
        now(),
      );
      if (decision === 'approve')
        db.prepare('INSERT OR IGNORE INTO steps VALUES (?, 5, ?)').run(sub.team_id, now());
      else db.prepare('DELETE FROM steps WHERE team_id=? AND step_index=5').run(sub.team_id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });
  app.get('/api/organizer/audit', requireOrganizer, (req, res) => {
    const page = pageOptions(req, res);
    if (!page) return;
    const rows = db
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(page.limit + 1, page.offset);
    res.json({
      entries: rows.slice(0, page.limit).map((r) => ({ ...r, details: JSON.parse(r.details) })),
      page: { ...page, nextOffset: rows.length > page.limit ? page.offset + page.limit : null },
    });
  });
  app.use('/api', (_req, res) => fail(res, 404, 'API-метод не найден.'));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error.type === 'entity.too.large') return fail(res, 413, 'Запрос слишком большой.');
    if (error instanceof SyntaxError && 'body' in error) return fail(res, 400, 'Некорректный JSON.');
    if (error.code?.startsWith('llm_')) return fail(res, error.status || 503, error.message, error.code);
    console.error(JSON.stringify({ event: 'server_error', status: 500, at: now() }));
    fail(res, 500, 'Внутренняя ошибка сервера.');
  });
  return app;
}
