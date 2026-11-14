import express from 'express';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { COUNTRIES, CATEGORIES, STEPS, cleanText, countryName, normalizePassportUrl, safeCsvCell } from './lib.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID()}`;
const fail = (res, status, message, code) => res.status(status).json({ error: message, ...(code ? { code } : {}) });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cookieOptions = secure => `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`;
function cookie(req, name) {
  const part = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}
function equalSecret(a, b) { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }

export function createApp({ db, llm, demoMode = true, organizerPassword = '', inviteCode, secureCookies = false, appOrigin = '' }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let same = false;
      try { same = new URL(req.headers.origin).host === req.get('host'); } catch { /* reject malformed origin */ }
      if (!same && req.headers.origin !== appOrigin) return fail(res, 403, 'Запрос с другого сайта запрещён.');
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const limiter = (max, windowMs = 60000) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false }, handler: (_req, res) => fail(res, 429, 'Слишком много запросов. Подождите немного.') });
  app.use('/api', limiter(300, 60000));
  const authLimiter = limiter(20, 15 * 60000);
  const mentorLimiter = limiter(30, 60000);
  const record = (teamId, type) => db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(id('event'), teamId, type, now());
  const activeChallenge = () => db.prepare("SELECT * FROM challenges WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1").get();
  const isOpen = () => { const c = activeChallenge(); return c && new Date(c.starts_at) <= new Date() && new Date(c.ends_at) > new Date(); };
  const code = () => inviteCode || activeChallenge()?.access_code;
  function session(req) {
    const token = cookie(req, 'ss_session');
    if (!token || token.length > 200) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(hash(token), now());
    return s || null;
  }
  function setSession(req, res, role, teamId = null) {
    const previous = cookie(req, 'ss_session');
    if (previous) db.prepare('DELETE FROM sessions WHERE token = ?').run(hash(previous));
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(hash(token), role, teamId, now(), new Date(Date.now() + 86400000).toISOString());
    res.setHeader('Set-Cookie', `ss_session=${token}; ${cookieOptions(secureCookies)}`);
  }
  const requireTeam = (req, res, next) => { const s = session(req); if (!s || s.role !== 'team') return fail(res, 401, 'Войдите в команду.'); req.session = s; next(); };
  const requireOrganizer = (req, res, next) => { const s = session(req); if (!s || s.role !== 'organizer') return fail(res, 401, 'Нужен вход организатора.'); req.session = s; next(); };
  function teamDetail(teamId) {
    const t = db.prepare(`SELECT t.*, s.name school_name, s.city school_city, s.country_code, s.is_demo school_is_demo,
      c.title challenge_title, c.ends_at FROM teams t JOIN schools s ON s.id=t.school_id JOIN challenges c ON c.id=t.challenge_id WHERE t.id=?`).get(teamId);
    if (!t) return null;
    const rows = db.prepare('SELECT * FROM steps WHERE team_id=?').all(teamId);
    const work = db.prepare('SELECT * FROM workbook WHERE team_id=?').all(teamId);
    const submission = db.prepare('SELECT * FROM submissions WHERE team_id=? ORDER BY updated_at DESC LIMIT 1').get(teamId) || null;
    return {
      id: t.id, name: t.name, nickname: t.nickname, createdAt: t.created_at, startedAt: t.started_at,
      isDemo: Boolean(t.school_is_demo), referredBySchoolId: t.referred_by_school_id,
      school: { id: t.school_id, name: t.school_name, city: t.school_city, countryCode: t.country_code, countryName: countryName(t.country_code), isDemo: Boolean(t.school_is_demo) },
      challenge: { id: t.challenge_id, title: t.challenge_title, endsAt: t.ends_at },
      steps: STEPS.map(step => ({ ...step, completed: rows.some(r => r.step_index === step.index), content: work.find(w => w.step_index === step.index)?.content || '', updatedAt: work.find(w => w.step_index === step.index)?.updated_at || null })),
      nextStep: STEPS.find(step => !rows.some(r => r.step_index === step.index))?.index || 5,
      submission: submission ? { ...submission, is_demo: Boolean(submission.is_demo) } : null,
      xp: rows.length * 100
    };
  }
  function leaderboard() {
    const rows = db.prepare(`SELECT s.id, s.name, s.city, s.country_code, s.is_demo,
      COUNT(DISTINCT t.id) teams, COUNT(DISTINCT CASE WHEN sub.status='approved' THEN sub.id END) verified
      FROM schools s JOIN teams t ON t.school_id=s.id LEFT JOIN submissions sub ON sub.team_id=t.id
      ${demoMode ? '' : 'WHERE s.is_demo=0'} GROUP BY s.id ORDER BY verified DESC, teams DESC, s.name ASC`).all();
    const countries = COUNTRIES.map(c => {
      const schools = rows.filter(r => r.country_code === c.code);
      return { country_code: c.code, countryName: c.name, flag: c.flag, schools: schools.length, teams: schools.reduce((n, r) => n + r.teams, 0), verified: schools.reduce((n, r) => n + r.verified, 0) };
    }).filter(r => r.teams).sort((a, b) => b.verified - a.verified || b.teams - a.teams || a.country_code.localeCompare(b.country_code));
    return { schools: rows.map((r, i) => ({ ...r, rank: i + 1, countryName: countryName(r.country_code), isDemo: Boolean(r.is_demo) })), countries: countries.map((r, i) => ({ ...r, rank: i + 1 })) };
  }
  function projects() {
    return db.prepare(`SELECT sub.id, sub.title, sub.url, sub.description, sub.is_demo, sub.reviewed_at, sub.category,
      t.name team_name, s.name school_name, s.country_code, s.city FROM submissions sub JOIN teams t ON t.id=sub.team_id
      JOIN schools s ON s.id=t.school_id WHERE sub.status='approved' ${demoMode ? '' : 'AND s.is_demo=0'} ORDER BY sub.reviewed_at DESC, sub.id ASC`).all()
      .map(r => ({ ...r, is_demo: Boolean(r.is_demo), countryName: countryName(r.country_code) }));
  }
  function organizerData(includeDemo = true) {
    const filter = includeDemo ? '' : ' WHERE s.is_demo=0 ';
    const teams = db.prepare(`SELECT t.id, t.name, t.nickname, t.created_at, t.started_at, t.referred_by_school_id, s.name school_name, s.id school_id, s.country_code, s.is_demo,
      (SELECT COUNT(*) FROM steps st WHERE st.team_id=t.id) steps_completed,
      sub.id submission_id, sub.title submission_title, sub.status submission_status, sub.is_demo submission_is_demo
      FROM teams t JOIN schools s ON s.id=t.school_id LEFT JOIN submissions sub ON sub.id=(SELECT id FROM submissions WHERE team_id=t.id ORDER BY updated_at DESC LIMIT 1) ${filter} ORDER BY t.created_at DESC, t.name`).all()
      .map(r => ({ ...r, is_demo: Boolean(r.is_demo), countryName: countryName(r.country_code), submissionIsDemo: Boolean(r.submission_is_demo) }));
    const teamIds = new Set(teams.map(t => t.id));
    const pending = db.prepare(`SELECT sub.*, t.name team_name, s.name school_name, s.country_code FROM submissions sub JOIN teams t ON t.id=sub.team_id JOIN schools s ON s.id=t.school_id WHERE sub.status='pending' ORDER BY sub.created_at ASC`).all()
      .filter(r => teamIds.has(r.team_id)).map(r => ({ ...r, is_demo: Boolean(r.is_demo), countryName: countryName(r.country_code), steps: db.prepare('SELECT step_index FROM steps WHERE team_id=?').all(r.team_id).map(s => s.step_index), workbook: db.prepare('SELECT step_index, content FROM workbook WHERE team_id=?').all(r.team_id) }));
    const funnel = { total: teams.length, started: teams.filter(t => t.started_at).length, submitted: teams.filter(t => t.submission_id).length, approved: teams.filter(t => t.submission_status === 'approved').length, pending: pending.length, returned: teams.filter(t => t.submission_status === 'returned').length };
    funnel.conversion = funnel.total ? +(funnel.approved / funnel.total * 100).toFixed(1) : 0;
    const validSchools = new Set(teams.map(t => t.school_id));
    const referred = teams.filter(t => t.referred_by_school_id && t.referred_by_school_id !== t.school_id && validSchools.has(t.referred_by_school_id));
    const referrals = referred.length;
    const referralsApproved = referred.filter(t => t.submission_status === 'approved').length;
    const usage = db.prepare(`SELECT COUNT(*) requests, SUM(CASE WHEN status='ok' AND source='llm' THEN 1 ELSE 0 END) llm_success,
      SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens, AVG(CASE WHEN source='llm' AND status='ok' THEN latency_ms END) latency_ms FROM llm_calls ${includeDemo ? '' : 'WHERE team_id IN (SELECT t.id FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.is_demo=0)'}`).get();
    const events = db.prepare(`SELECT e.team_id, e.type, e.created_at FROM events e JOIN teams t ON t.id=e.team_id JOIN schools s ON s.id=t.school_id ${includeDemo ? '' : 'WHERE s.is_demo=0'} ORDER BY e.created_at`).all();
    const created = new Map(events.filter(e => e.type === 'team_created').map(e => [e.team_id, new Date(e.created_at).getTime()]));
    const firstValues = events.filter(e => e.type === 'first_note' && created.has(e.team_id)).map(e => (new Date(e.created_at).getTime() - created.get(e.team_id)) / 60000).filter(n => n >= 0).sort((a,b) => a-b);
    const medianFirstValueMinutes = firstValues.length ? (firstValues[Math.floor((firstValues.length - 1) / 2)] + firstValues[Math.floor(firstValues.length / 2)]) / 2 : null;
    const firstNotes = new Map(events.filter(e => e.type === 'first_note').map(e => [e.team_id, new Date(e.created_at).getTime()]));
    const matureCohorts = [...firstNotes].filter(([,time]) => time <= Date.now() - 8 * 86400000);
    const returnedD7 = matureCohorts.filter(([teamId,time]) => events.some(e => e.team_id === teamId && e.type === 'activity' && new Date(e.created_at).getTime() - time >= 6 * 86400000 && new Date(e.created_at).getTime() - time <= 8 * 86400000)).length;
    return { funnel, teams, pending, referrals, referralsApproved, includeDemo, usage, activation: { medianFirstValueMinutes, measuredTeams: firstValues.length, d7Eligible: matureCohorts.length, d7Returned: returnedD7, d7Percent: matureCohorts.length ? +(returnedD7 / matureCohorts.length * 100).toFixed(1) : null } };
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'startify-sprint', version: '0.2.0' }));
  app.get('/api/bootstrap', (_req, res) => {
    const c = activeChallenge();
    const { access_code, ...challenge } = c;
    const all = organizerData(demoMode);
    res.json({ challenge: { ...challenge, isOpen: isOpen() }, countries: COUNTRIES, categories: CATEGORIES, steps: STEPS,
      demoMode, inviteHint: demoMode ? code() : null, llm: llm.publicStatus(),
      stats: { teams: all.funnel.total, schools: leaderboard().schools.length, countries: leaderboard().countries.length, verified: all.funnel.approved },
      leaderboard: leaderboard(), projects: projects(), schools: db.prepare(`SELECT id, name, city, country_code, is_demo FROM schools ${demoMode ? '' : 'WHERE is_demo=0'} ORDER BY name`).all(),
      demoTeams: demoMode ? db.prepare("SELECT t.id, t.name FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.is_demo=1 ORDER BY t.name").all() : [] });
  });
  app.get('/api/me', (req, res) => { const s = session(req); if (!s) return res.json({ role: 'guest' }); res.json(s.role === 'team' ? { role: 'team', team: teamDetail(s.team_id) } : { role: 'organizer' }); });
  app.post('/api/demo/login', authLimiter, (req, res) => {
    if (!demoMode) return fail(res, 404, 'Демо-вход отключён.');
    const role = req.body?.role;
    if (!['team', 'organizer'].includes(role)) return fail(res, 400, 'Неизвестная роль.');
    const teamId = role === 'team' ? cleanText(req.body?.teamId, 120) || 'team-eduquest' : null;
    const team = teamId && db.prepare('SELECT t.id FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.id=? AND s.is_demo=1').get(teamId);
    if (role === 'team' && !team) return fail(res, 404, 'Демо-команда не найдена.');
    setSession(req, res, role, teamId);
    res.json({ role, ...(teamId ? { team: teamDetail(teamId) } : {}) });
  });
  app.post('/api/auth/organizer', authLimiter, (req, res) => {
    if (!organizerPassword) return fail(res, 403, 'Вход организатора не настроен.');
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length >200 || !equalSecret(password, organizerPassword)) return fail(res, 401, 'Неверный пароль.');
    setSession(req, res, 'organizer'); res.json({ role: 'organizer' });
  });
  app.post('/api/auth/team', authLimiter, (req, res) => {
    const teamId = cleanText(req.body?.teamId, 120), key = cleanText(req.body?.recoveryKey, 100);
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
    if (!t?.access_hash || !equalSecret(hash(key), t.access_hash)) return fail(res, 401, 'Неверный ID команды или ключ восстановления.');
    setSession(req, res, 'team', t.id); res.json({ role: 'team', team: teamDetail(t.id) });
  });
  app.post('/api/logout', (req, res) => { const token = cookie(req, 'ss_session'); if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); res.setHeader('Set-Cookie', `ss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`); res.json({ role: 'guest' }); });
  app.post('/api/teams', authLimiter, (req, res) => {
    if (!isOpen()) return fail(res, 409, 'Спринт ещё не начался или уже завершён.');
    const input = z.object({ accessCode: z.string().max(80), countryCode: z.enum(COUNTRIES.map(c => c.code)), schoolName: z.string().trim().min(2).max(120), city: z.string().trim().max(80).default(''), teamName: z.string().trim().min(2).max(80), nickname: z.string().trim().min(1).max(60), fromSchoolId: z.string().max(120).nullable().optional(), consent: z.literal(true), ageConfirmed: z.literal(true) }).safeParse(req.body);
    if (!input.success) return fail(res, 400, 'Заполните поля команды и подтвердите возраст 13+ и правила обработки учебных данных.');
    const f = input.data;
    if (!equalSecret(f.accessCode.toUpperCase(), code().toUpperCase())) return fail(res, 400, 'Неверный код приглашения.');
    const from = f.fromSchoolId && db.prepare('SELECT id FROM schools WHERE id=?').get(f.fromSchoolId) ? f.fromSchoolId : null;
    const normalized = f.schoolName.toLowerCase();
    const recoveryKey = randomBytes(18).toString('base64url');
    let teamId;
    db.exec('BEGIN IMMEDIATE');
    try {
      let school = db.prepare('SELECT * FROM schools WHERE country_code=? AND normalized_name=? AND lower(city)=lower(?)').get(f.countryCode, normalized, f.city);
      if (!school) { const schoolId = id('school'); db.prepare('INSERT INTO schools VALUES (?, ?, ?, ?, ?, 0)').run(schoolId, f.schoolName, normalized, f.countryCode, f.city); school = { id: schoolId }; }
      if (db.prepare('SELECT id FROM teams WHERE challenge_id=? AND school_id=? AND normalized_name=?').get(activeChallenge().id, school.id, f.teamName.toLowerCase())) { db.exec('ROLLBACK'); return fail(res, 409, 'Команда с таким названием уже есть. Войдите по ключу восстановления.'); }
      teamId = id('team');
      db.prepare('INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, referred_by_school_id, created_at, started_at, access_hash, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
        .run(teamId, activeChallenge().id, school.id, f.teamName, f.teamName.toLowerCase(), f.nickname, from, now(), hash(recoveryKey), now());
      record(teamId, 'team_created');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    setSession(req, res, 'team', teamId);
    res.status(201).json({ team: teamDetail(teamId), teamId, recoveryKey });
  });
  app.get('/api/team', requireTeam, (req, res) => res.json({ team: teamDetail(req.session.team_id) }));
  function saveWork(teamId, stepIndex, content) {
    const first = !db.prepare("SELECT id FROM events WHERE team_id=? AND type='first_note'").get(teamId);
    db.prepare('INSERT INTO workbook VALUES (?, ?, ?, ?) ON CONFLICT(team_id, step_index) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at').run(teamId, stepIndex, content, now());
    db.prepare('UPDATE teams SET started_at=COALESCE(started_at, ?) WHERE id=?').run(now(), teamId);
    if (first && content.length) { record(teamId, 'first_note'); record(teamId, 'activated'); }
    record(teamId, 'activity');
  }
  app.patch('/api/team/workbook', requireTeam, (req, res) => {
    const stepIndex = Number(req.body?.stepIndex), content = req.body?.content;
    if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > 4 || typeof content !== 'string' || content.length > 5000) return fail(res, 400, 'Некорректные заметки: этап 1–4, до 5000 символов.');
    const team = teamDetail(req.session.team_id);
    if (team.submission && ['pending', 'approved'].includes(team.submission.status)) return fail(res, 409, 'Заметки зафиксированы на время проверки и после зачёта.');
    saveWork(req.session.team_id, stepIndex, content.trim()); res.json({ team: teamDetail(req.session.team_id) });
  });
  app.patch('/api/team/steps', requireTeam, (req, res) => {
    const teamId = req.session.team_id, team = teamDetail(teamId), index = Number(req.body?.stepIndex);
    if (!Number.isInteger(index) || index < 1 || index > 4) return fail(res, 400, 'Пятый этап подтверждает только организатор.');
    if (typeof req.body?.completed !== 'boolean') return fail(res, 400, 'Укажите статус этапа.');
    if (team.submission && ['pending', 'approved'].includes(team.submission.status)) return fail(res, 409, 'Во время проверки и после зачёта этапы заблокированы.');
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : team.steps[index - 1].content;
    if (typeof content !== 'string' || content.length > 5000) return fail(res, 400, 'Заметки слишком длинные.');
    db.exec('BEGIN IMMEDIATE');
    try {
      saveWork(teamId, index, content);
      if (req.body.completed) {
        if (content.length < 80) { db.exec('ROLLBACK'); return fail(res, 400, 'Для зачёта этапа добавьте хотя бы 80 символов содержательных заметок.'); }
        if (index > 1 && !team.steps[index - 2].completed) { db.exec('ROLLBACK'); return fail(res, 409, 'Сначала завершите предыдущий этап.'); }
        const inserted = db.prepare('INSERT OR IGNORE INTO steps VALUES (?, ?, ?)').run(teamId, index, now());
        if (inserted.changes) record(teamId, 'checkpoint_completed');
      } else {
        if (team.steps.slice(index).some(s => s.completed)) { db.exec('ROLLBACK'); return fail(res, 409, 'Сначала верните в работу более поздние этапы.'); }
        db.prepare('DELETE FROM steps WHERE team_id=? AND step_index=?').run(teamId, index);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ team: teamDetail(teamId) });
  });
  app.post('/api/team/submission', limiter(12, 60000), requireTeam, (req, res) => {
    if (!isOpen()) return fail(res, 409, 'Приём проектов завершён.');
    const team = teamDetail(req.session.team_id);
    if (team.steps.slice(0, 4).some(s => !s.completed)) return fail(res, 409, 'Сначала завершите первые четыре этапа.');
    if (team.submission && ['pending', 'approved'].includes(team.submission.status)) return fail(res, 409, 'Проект уже на проверке или подтверждён.');
    const title = cleanText(req.body?.title, 120), description = cleanText(req.body?.description, 1000), category = req.body?.category;
    if (title.length < 2 || description.length < 30 || !CATEGORIES.includes(category)) return fail(res, 400, 'Укажите название, категорию и описание от 30 символов.');
    const normalized = normalizePassportUrl(req.body?.url);
    if (!normalized.ok) return fail(res, 400, normalized.error);
    if (db.prepare('SELECT id FROM submissions WHERE normalized_url=? AND team_id<>?').get(normalized.url, team.id)) return fail(res, 409, 'Этот паспорт уже отправлен другой командой.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (team.submission?.status === 'returned') db.prepare("UPDATE submissions SET title=?, url=?, normalized_url=?, description=?, category=?, status='pending', review_comment='', review_checklist='{}', updated_at=?, reviewed_at=NULL WHERE id=?")
        .run(title, normalized.url, normalized.url, description, category, now(), team.submission.id);
      else db.prepare("INSERT INTO submissions (id, team_id, challenge_id, title, url, normalized_url, description, status, created_at, updated_at, category) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
        .run(id('sub'), team.id, team.challenge.id, title, normalized.url, normalized.url, description, now(), now(), category);
      record(team.id, team.submission?.status === 'returned' ? 'project_resubmitted' : 'project_submitted');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); if (String(error.message).includes('UNIQUE')) return fail(res, 409, 'Этот паспорт уже используется.'); throw error; }
    res.status(201).json({ team: teamDetail(team.id) });
  });
  app.get('/api/team/mentor', requireTeam, (req, res) => {
    const messages = db.prepare('SELECT * FROM (SELECT id, step_index, mode, source, content, created_at FROM mentor_messages WHERE team_id=? ORDER BY created_at DESC, id DESC LIMIT 30) ORDER BY created_at ASC, id ASC').all(req.session.team_id).map(m => ({ ...m, result: JSON.parse(m.content) }));
    res.json({ messages });
  });
  app.post('/api/team/mentor', mentorLimiter, requireTeam, asyncRoute(async (req, res) => {
    const parsed = z.object({ stepIndex: z.number().int().min(1).max(4), mode: z.enum(['guide', 'review', 'draft', 'pitch']), message: z.string().max(1500).default(''), language: z.enum(['ru', 'en']).default('ru') }).strict().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'Некорректный запрос наставнику.');
    const teamId = req.session.team_id, team = teamDetail(teamId), input = parsed.data;
    if (llm.publicStatus().enabled) {
      const count = db.prepare("SELECT COUNT(*) c FROM llm_calls WHERE team_id=? AND created_at>?").get(teamId, new Date(Date.now() - 86400000).toISOString()).c;
      if (count >= 40) return fail(res, 429, 'Лимит 40 обращений к модели в сутки. Шаблоны и заметки доступны без ограничений.', 'llm_quota');
    }
    const started = Date.now();
    let result;
    try { result = await llm.generate({ ...input, workbook: Object.fromEntries(team.steps.slice(0, 4).map(s => [s.index, s.content])) }); }
    catch (error) { db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)').run(id('call'), teamId, 'llm', llm.publicStatus().model, 'error', Date.now() - started, now()); throw error; }
    const latency = Date.now() - started;
    db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('call'), teamId, result.source, result.model, 'ok', latency, result.usage?.promptTokens || 0, result.usage?.completionTokens || 0, now());
    db.prepare('INSERT INTO mentor_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('msg'), teamId, input.stepIndex, input.mode, result.source, JSON.stringify(result), now());
    res.json({ result, latency });
  }));
  app.delete('/api/team/mentor', requireTeam, (req, res) => { db.prepare('DELETE FROM mentor_messages WHERE team_id=?').run(req.session.team_id); res.json({ ok: true }); });
  app.delete('/api/team/data', requireTeam, (req, res) => { if (teamDetail(req.session.team_id)?.isDemo) return fail(res, 409, 'Общие демо-команды не удаляются. Удаление доступно для собственной пилотной команды.'); db.prepare('DELETE FROM teams WHERE id=?').run(req.session.team_id); res.setHeader('Set-Cookie', `ss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`); res.json({ ok: true }); });
  app.get('/api/organizer', requireOrganizer, (req, res) => res.json(organizerData(req.query.includeDemo !== 'false')));
  app.get('/api/organizer/export.csv', requireOrganizer, (req, res) => {
    const data = organizerData(req.query.includeDemo !== 'false');
    const rows = [['Команда', 'Школа', 'Страна', 'Этапы', 'Статус', 'Демо', 'Создана'], ...data.teams.map(t => [t.name, t.school_name, t.countryName, t.steps_completed, t.submission_status || 'new', t.is_demo ? 'да' : 'нет', t.created_at])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="startify-funnel.csv"'); res.send('\uFEFF' + rows.map(r => r.map(safeCsvCell).join(',')).join('\r\n'));
  });
  app.post('/api/organizer/llm/test', requireOrganizer, asyncRoute(async (_req, res) => {
    if (!llm.publicStatus().enabled) return fail(res, 409, 'LLM_ENABLED=false. Настройте серверный адаптер.');
    const start = Date.now();
    const result = await llm.generate({ stepIndex: 1, mode: 'guide', message: 'Ответь одним коротким вопросом о проблеме школьника.', workbook: {}, language: 'ru' });
    res.json({ ok: true, model: result.model, latency: Date.now() - start, usage: result.usage || null });
  }));
  app.post('/api/organizer/submissions/:id/review', requireOrganizer, (req, res) => {
    const sub = db.prepare('SELECT * FROM submissions WHERE id=?').get(req.params.id);
    if (!sub) return fail(res, 404, 'Заявка не найдена.');
    const decision = req.body?.decision, comment = cleanText(req.body?.comment, 500);
    if (!['approve', 'return'].includes(decision)) return fail(res, 400, 'Неизвестное решение.');
    if (decision === 'return' && comment.length < 3) return fail(res, 400, 'Объясните, что нужно доработать.');
    const checklist = req.body?.checklist;
    if (decision === 'approve' && (!checklist || ['accessible', 'original', 'safe', 'complete'].some(k => checklist[k] !== true))) return fail(res, 400, 'Подтвердите все четыре пункта ручной проверки.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT status FROM submissions WHERE id=?').get(sub.id).status !== 'pending') { db.exec('ROLLBACK'); return fail(res, 409, 'Заявка уже проверена.'); }
      db.prepare('UPDATE submissions SET status=?, review_comment=?, review_checklist=?, reviewed_at=?, updated_at=? WHERE id=?').run(decision === 'approve' ? 'approved' : 'returned', comment, JSON.stringify(decision === 'approve' ? checklist : {}), now(), now(), sub.id);
      record(sub.team_id, decision === 'approve' ? 'project_approved' : 'project_returned');
      if (decision === 'approve') db.prepare('INSERT OR IGNORE INTO steps VALUES (?, 5, ?)').run(sub.team_id, now());
      else db.prepare('DELETE FROM steps WHERE team_id=? AND step_index=5').run(sub.team_id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => fail(res, 404, 'API-метод не найден.'));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error.type === 'entity.too.large') return fail(res, 413, 'Запрос слишком большой.');
    if (error instanceof SyntaxError && 'body' in error) return fail(res, 400, 'Некорректный JSON.');
    if (error.code?.startsWith('llm_')) return fail(res, error.status || 503, error.message, error.code);
    console.error(JSON.stringify({ event: 'server_error', message: error.message, at: now() }));
    fail(res, 500, 'Внутренняя ошибка сервера.');
  });
  return app;
}
