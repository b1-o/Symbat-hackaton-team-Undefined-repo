import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createLlmAdapter, readLlmConfig } from '../server/llm.js';
import { calculateMetrics } from '../server/metrics.js';

function setup(t, options = {}) {
  const db = createDatabase(':memory:', { seedDemo: options.seedDemo !== false });
  const llm = options.llm || createLlmAdapter(readLlmConfig({ LLM_ENABLED: 'false' }));
  const app = createApp({
    db,
    llm,
    demoMode: options.demoMode !== false,
    organizerPassword: 'test-password-123',
    inviteCode: 'TEST-CODE',
    ...options,
  });
  t.after(() => db.close());
  return { db, app };
}
const cookie = (res) => res.headers['set-cookie'][0].split(';')[0];
async function team(app, role = 'team', teamId) {
  const r = await request(app).post('/api/demo/login').send({ role, teamId }).expect(200);
  return cookie(r);
}
const notes =
  'Мы проверяем проблему потерянных вещей в школе. Пользователь — ученик, который ищет свою куртку после урока. Записываем наблюдения и гипотезы отдельно.';
async function completeSteps(agent) {
  for (let i = 1; i <= 4; i++)
    await agent.patch('/api/team/steps').send({ stepIndex: i, completed: true, content: notes }).expect(200);
}

test('bootstrap never leaks invite code, sessions or recovery hashes', async (t) => {
  const { app, db } = setup(t);
  const r = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(r.body.challenge.access_code, undefined);
  assert.equal(r.body.inviteHint, 'TEST-CODE');
  assert.ok(r.body.demoTeams.length);
  assert.ok(!JSON.stringify(r.body).includes('access_hash'));
  assert.ok(db.prepare('SELECT COUNT(*) c FROM teams').get().c === 6);
});
test('production disables public demo organizer and requires password', async (t) => {
  const { app } = setup(t, { demoMode: false });
  await request(app).post('/api/demo/login').send({ role: 'organizer' }).expect(404);
  await request(app).post('/api/auth/organizer').send({ password: 'wrong' }).expect(401);
  const r = await request(app)
    .post('/api/auth/organizer')
    .send({ password: 'test-password-123' })
    .expect(200);
  assert.match(r.headers['set-cookie'][0], /HttpOnly/);
  await request(app).get('/api/organizer').set('Cookie', cookie(r)).expect(200);
  const boot = await request(app).get('/api/bootstrap');
  assert.equal(boot.body.inviteHint, null);
  assert.deepEqual(boot.body.demoTeams, []);
});
test('team notes are private; other team and guest cannot read', async (t) => {
  const { app } = setup(t);
  const a = await team(app, 'team', 'team-eduquest'),
    b = await team(app, 'team', 'team-studylab');
  await request(app)
    .patch('/api/team/workbook')
    .set('Cookie', a)
    .send({ stepIndex: 1, content: 'Секретный учебный черновик' })
    .expect(200);
  const rb = await request(app).get('/api/team').set('Cookie', b);
  assert.ok(!JSON.stringify(rb.body).includes('Секретный'));
  await request(app).get('/api/team').expect(401);
  await request(app).get('/api/organizer').set('Cookie', a).expect(401);
});
test('checkpoint requires real text and sequential completion; fifth is human-only', async (t) => {
  const { app } = setup(t);
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team', teamId: 'team-studylab' });
  await agent.patch('/api/team/steps').send({ stepIndex: 1, completed: true, content: 'short' }).expect(400);
  await agent.patch('/api/team/steps').send({ stepIndex: 2, completed: true, content: notes }).expect(409);
  await agent.patch('/api/team/steps').send({ stepIndex: 5, completed: true, content: notes }).expect(400);
  await completeSteps(agent);
  const r = await agent.get('/api/team');
  assert.equal(r.body.team.steps.filter((s) => s.completed).length, 4);
  assert.equal(r.body.team.xp, 400);
  await agent.patch('/api/team/steps').send({ stepIndex: 1, completed: false }).expect(409);
});
test('submission → manual checklist → approved → unique showcase and score', async (t) => {
  const { app, db } = setup(t);
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team' });
  const sub = {
    title: 'LostFound',
    url: 'https://aistartify.com/startup/test-lostfound',
    description: 'Помогаем школьникам находить потерянные вещи без публикации личных данных.',
    category: 'EdTech',
  };
  await agent.post('/api/team/submission').send(sub).expect(409);
  await completeSteps(agent);
  await agent.post('/api/team/submission').send(sub).expect(201);
  await agent.post('/api/team/submission').send(sub).expect(409);
  await agent.patch('/api/team/workbook').send({ stepIndex: 1, content: notes }).expect(409); // evidence is frozen during review
  await agent.patch('/api/team/steps').send({ stepIndex: 1, completed: false }).expect(409);
  const org = await team(app, 'organizer');
  const pending = await request(app).get('/api/organizer').set('Cookie', org);
  const item = pending.body.pending.find((p) => p.title === 'LostFound');
  assert.ok(item.workbook.length === 4);
  await request(app)
    .post(`/api/organizer/submissions/${item.id}/review`)
    .set('Cookie', org)
    .send({ decision: 'approve' })
    .expect(400);
  const checklist = { accessible: true, original: true, safe: true, complete: true };
  await request(app)
    .post(`/api/organizer/submissions/${item.id}/review`)
    .set('Cookie', org)
    .send({ decision: 'approve', checklist })
    .expect(200);
  await request(app)
    .post(`/api/organizer/submissions/${item.id}/review`)
    .set('Cookie', org)
    .send({ decision: 'approve', checklist })
    .expect(409);
  const r = await agent.get('/api/team');
  assert.equal(r.body.team.steps.filter((s) => s.completed).length, 5);
  assert.equal(r.body.team.submission.status, 'approved');
  const board = await request(app).get('/api/bootstrap');
  assert.equal(board.body.projects.filter((p) => p.title === 'LostFound').length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='approved'").get().c, 3);
  const other = request.agent(app);
  await other.post('/api/demo/login').send({ role: 'team', teamId: 'team-studylab' });
  await completeSteps(other);
  await other
    .post('/api/team/submission')
    .send({ ...sub, url: sub.url + '?utm=copy#top' })
    .expect(409);
});
test('returned submission keeps identity and can be corrected', async (t) => {
  const { app } = setup(t);
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team' });
  await completeSteps(agent);
  await agent
    .post('/api/team/submission')
    .send({
      title: 'SchoolLoop',
      url: 'https://aistartify.com/startup/return-test',
      description: 'Учебный проект для проверки процесса возврата и повторной отправки материалов.',
      category: 'EdTech',
    })
    .expect(201);
  const orgAgent = request.agent(app);
  await orgAgent.post('/api/demo/login').send({ role: 'organizer' });
  let orgData = await orgAgent.get('/api/organizer');
  let item = orgData.body.pending.find((p) => p.title === 'SchoolLoop');
  await orgAgent
    .post(`/api/organizer/submissions/${item.id}/review`)
    .send({ decision: 'return', comment: '' })
    .expect(400);
  await orgAgent
    .post(`/api/organizer/submissions/${item.id}/review`)
    .send({ decision: 'return', comment: 'Добавьте результаты интервью и проверьте описание.' })
    .expect(200);
  let r = await agent.get('/api/team');
  assert.equal(r.body.team.submission.status, 'returned');
  assert.equal(r.body.team.steps.filter((s) => s.completed).length, 4);
  await agent.patch('/api/team/steps').send({ stepIndex: 4, completed: false }).expect(200);
  await agent.patch('/api/team/steps').send({ stepIndex: 3, completed: false }).expect(200);
  await agent.patch('/api/team/steps').send({ stepIndex: 2, completed: false }).expect(200);
  await agent
    .patch('/api/team/steps')
    .send({ stepIndex: 2, completed: true, content: notes + ' Интервью проведены, выводы записаны.' })
    .expect(200);
  await agent.patch('/api/team/steps').send({ stepIndex: 3, completed: true, content: notes }).expect(200);
  await agent.patch('/api/team/steps').send({ stepIndex: 4, completed: true, content: notes }).expect(200);
  await agent
    .post('/api/team/submission')
    .send({
      title: 'SchoolLoop v2',
      url: 'https://aistartify.com/startup/return-test',
      description: 'Обновлённое описание проекта с результатами проверки проблемы и следующим шагом.',
      category: 'EdTech',
    })
    .expect(201);
  r = await agent.get('/api/team');
  assert.equal(r.body.team.submission.id, item.id);
  assert.equal(r.body.team.submission.status, 'pending');
});
test('new team gets one-time recovery key and can sign in on another client', async (t) => {
  const { app, db } = setup(t, { demoMode: false });
  const fields = {
    accessCode: 'TEST-CODE',
    countryCode: 'KZ',
    schoolName: 'Pilot School',
    city: 'Almaty',
    teamName: 'Orbit Lab',
    nickname: 'Captain',
    consent: true,
    ageConfirmed: true,
  };
  await request(app)
    .post('/api/teams')
    .send({ ...fields, consent: false })
    .expect(400);
  await request(app)
    .post('/api/teams')
    .send({ ...fields, accessCode: 'wrong' })
    .expect(400);
  const r = await request(app).post('/api/teams').send(fields).expect(201);
  assert.ok(r.body.recoveryKey.length >= 20);
  assert.ok(
    db.prepare('SELECT access_hash FROM teams WHERE id=?').get(r.body.teamId).access_hash !==
      r.body.recoveryKey,
  );
  await request(app).post('/api/teams').send(fields).expect(409);
  const login = await request(app)
    .post('/api/auth/team')
    .send({ teamId: r.body.teamId, recoveryKey: r.body.recoveryKey })
    .expect(200);
  const me = await request(app).get('/api/me').set('Cookie', cookie(login));
  assert.equal(me.body.team.name, 'Orbit Lab');
  assert.ok(!JSON.stringify(me.body).includes('recoveryKey'));
  await request(app).post('/api/auth/team').send({ teamId: r.body.teamId, recoveryKey: 'wrong' }).expect(401);
});
test('CSRF origin rejected, sessions hashed and logout invalidates token', async (t) => {
  const { app, db } = setup(t);
  const r = await request(app).post('/api/demo/login').send({ role: 'team' }).expect(200);
  const c = cookie(r);
  const raw = c.split('=')[1];
  assert.ok(!db.prepare('SELECT token FROM sessions WHERE token=?').get(raw));
  await request(app)
    .post('/api/logout')
    .set('Origin', 'https://evil.example')
    .set('Cookie', c)
    .send({})
    .expect(403);
  await request(app).post('/api/logout').set('Cookie', c).send({}).expect(200);
  await request(app).get('/api/team').set('Cookie', c).expect(401);
});
test('organizer can exclude demo, export safe CSV; AI never approves', async (t) => {
  const { app } = setup(t);
  const org = await team(app, 'organizer');
  const live = await request(app).get('/api/organizer?includeDemo=false').set('Cookie', org).expect(200);
  assert.equal(live.body.funnel.total, 0);
  const csv = await request(app).get('/api/organizer/export.csv').set('Cookie', org).expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /EcoSchool/);
  await request(app).post('/api/organizer/llm/test').set('Cookie', org).send({}).expect(409);
});
test('mentor response persists, invalid request rejected, history can be deleted', async (t) => {
  const { app } = setup(t);
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team' });
  await agent
    .post('/api/team/mentor')
    .send({ stepIndex: 1, mode: 'guide', message: 'Что дальше?' })
    .expect(200);
  await agent.post('/api/team/mentor').send({ stepIndex: 5, mode: 'guide' }).expect(400);
  let r = await agent.get('/api/team/mentor');
  assert.equal(r.body.messages.length, 1);
  assert.equal(r.body.messages[0].source, 'template');
  await agent.delete('/api/team/mentor').expect(200);
  r = await agent.get('/api/team/mentor');
  assert.equal(r.body.messages.length, 0);
});
test('LLM errors are honest and counted, quota enforced', async (t) => {
  const llm = {
    publicStatus: () => ({ enabled: true, model: 'smallthinker' }),
    generate: async (t) => {
      throw Object.assign(new Error('Offline'), { code: 'llm_unavailable', status: 503 });
    },
  };
  const { app, db } = setup(t, { llm });
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team' });
  const r = await agent.post('/api/team/mentor').send({ stepIndex: 1, mode: 'guide' }).expect(503);
  assert.equal(r.body.code, 'llm_unavailable');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM llm_calls WHERE status='error'").get().c, 1);
  db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)').run(
    'quota-test',
    'team-eduquest',
    'llm',
    'smallthinker',
    'ok',
    new Date().toISOString(),
  );
  // Forty requests in the last day including this one is still below the cap.
  for (let i = 0; i < 39; i++)
    db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)').run(
      `quota-${i}`,
      'team-eduquest',
      'llm',
      'smallthinker',
      'ok',
      new Date().toISOString(),
    );
  await agent.post('/api/team/mentor').send({ stepIndex: 1, mode: 'guide' }).expect(429);
});
test('non-demo seed creates no fictional schools or projects', async (t) => {
  const { app } = setup(t, { seedDemo: false, demoMode: false });
  const r = await request(app).get('/api/bootstrap');
  assert.equal(r.body.stats.teams, 0);
  assert.equal(r.body.projects.length, 0);
  assert.ok(r.body.challenge.id);
});
test('expired sessions are rejected', async (t) => {
  const { app, db } = setup(t);
  const c = await team(app);
  db.prepare('UPDATE sessions SET expires_at=?').run('2020-01-01T00:00:00.000Z');
  await request(app).get('/api/team').set('Cookie', c).expect(401);
});
test('real activation events, no invented historical telemetry, data deletion', async (t) => {
  const { app, db } = setup(t, {
    seedDemo: false,
    demoMode: false,
    organizerPassword: 'organizer-secret',
    inviteCode: 'SPRINT-2026',
  });
  const agent = request.agent(app);
  await agent
    .post('/api/teams')
    .send({
      teamName: 'Measured Team',
      schoolName: 'Measured School',
      countryCode: 'KZ',
      nickname: 'Student',
      accessCode: 'SPRINT-2026',
      consent: true,
      ageConfirmed: true,
    })
    .expect(201);
  await agent
    .patch('/api/team/workbook')
    .send({ stepIndex: 1, content: 'Первая заметка команды о проблеме в школе.' })
    .expect(200);
  await agent
    .patch('/api/team/workbook')
    .send({ stepIndex: 1, content: 'Вторая версия заметки команды о проблеме в школе.' })
    .expect(200);
  const orgAgent = request.agent(app);
  await orgAgent.post('/api/auth/organizer').send({ password: 'organizer-secret' }).expect(200);
  const metrics = await orgAgent.get('/api/organizer').expect(200);
  assert.equal(metrics.body.activation.measuredTeams, 1);
  assert.ok(
    metrics.body.activation.medianFirstValueMinutes >= 0 &&
      metrics.body.activation.medianFirstValueMinutes < 0.1,
  );
  assert.equal(metrics.body.activation.d7Eligible, 0);
  assert.equal(metrics.body.activation.d7Percent, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='first_note'").get().n, 1);
  await agent.delete('/api/team/data').expect(200);
  await agent.get('/api/team').expect(401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teams').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workbook').get().n, 0);
});
test('non-demo public views hide seeded demo rows; referral approvals are counted', async (t) => {
  const { app } = setup(t, { demoMode: false });
  const r = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(r.body.projects.length, 0);
  assert.equal(r.body.leaderboard.schools.length, 0);
  assert.equal(r.body.stats.teams, 0);
  assert.equal(r.body.schools.length, 0);
  const { app: demoApp } = setup(t);
  const org = request.agent(demoApp);
  await org.post('/api/demo/login').send({ role: 'organizer' }).expect(200);
  const data = await org.get('/api/organizer').expect(200);
  assert.equal(data.body.referrals, 2);
  assert.equal(data.body.referralsApproved, 0);
});

test('public project pagination filters without leaking notes or counting a page as the total', async (t) => {
  const { app } = setup(t);
  const first = await request(app).get('/api/projects?limit=1').expect(200);
  assert.equal(first.body.projects.length, 1);
  assert.equal(first.body.page.nextOffset, 1);
  const next = await request(app).get('/api/projects?limit=1&offset=1').expect(200);
  assert.notEqual(first.body.projects[0].id, next.body.projects[0].id);
  const filtered = await request(app)
    .get('/api/projects?country=KZ&category=ClimateTech&q=EcoTrack')
    .expect(200);
  assert.equal(filtered.body.projects.length, 1);
  assert.ok(!JSON.stringify(filtered.body).includes('workbook'));
  assert.equal((await request(app).get('/api/projects?q=%25').expect(200)).body.projects.length, 0);
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=oops'])
    await request(app).get(`/api/projects?${query}`).expect(400);
  const boot = await request(app).get('/api/bootstrap');
  assert.equal(boot.body.totalProjects, 2);
  const privateApp = setup(t, { demoMode: false }).app;
  assert.equal((await request(privateApp).get('/api/projects')).body.projects.length, 0);
});

test('organizer pages retain global metrics, audit decisions and export every page', async (t) => {
  const { app, db } = setup(t);
  const org = request.agent(app);
  await org.post('/api/demo/login').send({ role: 'organizer' });
  const first = await org.get('/api/organizer?limit=1').expect(200);
  assert.equal(first.body.teams.length, 1);
  assert.equal(first.body.pending.length, 1);
  assert.equal(first.body.funnel.total, 6);
  assert.equal(first.body.page.nextTeamsOffset, 1);
  assert.equal(first.body.page.nextPendingOffset, 1);
  const next = await org.get('/api/organizer?limit=1&offset=1');
  assert.notEqual(first.body.teams[0].id, next.body.teams[0].id);
  const id = first.body.pending[0].id;
  await org
    .post(`/api/organizer/submissions/${id}/review`)
    .send({ decision: 'return', comment: 'Нужны результаты интервью.' });
  const audit = await org.get('/api/organizer/audit');
  assert.equal(audit.body.entries[0].target_id, id);
  assert.equal(audit.body.entries[0].details.decision, 'return');
  assert.ok(!JSON.stringify(audit.body).includes('token'));
  const csv = await org.get('/api/organizer/export.csv');
  for (const name of ['EcoSchool', 'EduQuest', 'SmartCampus', 'TechBridge', 'GreenFuture', 'StudyLab'])
    assert.ok(csv.text.includes(name));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_log').get().c, 1);
});

test('parallel mentor calls cannot overrun a remaining daily model slot', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const llm = {
    publicStatus: () => ({ enabled: true, model: 'test-model' }),
    generate: async () => {
      await gate;
      return {
        source: 'llm',
        model: 'test-model',
        reply: 'Проверьте проблему.',
        suggestions: [],
        nextQuestion: 'Что узнали?',
        draft: '',
      };
    },
  };
  const { app, db } = setup(t, { llm });
  for (let i = 0; i < 39; i++)
    db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)').run(
      `reserved-${i}`,
      'team-eduquest',
      'llm',
      'test-model',
      'ok',
      new Date().toISOString(),
    );
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team' });
  const a = agent
    .post('/api/team/mentor')
    .send({ stepIndex: 1, mode: 'guide' })
    .then((r) => r.status);
  await new Promise((resolve) => setImmediate(resolve));
  const b = await agent.post('/api/team/mentor').send({ stepIndex: 1, mode: 'guide' });
  assert.equal(b.status, 429);
  release();
  assert.equal(await a, 200);
});

test('CSP is restrictive and production does not allow development eval', async (t) => {
  const { app } = setup(t);
  const response = await request(app).get('/api/health');
  assert.match(response.headers['content-security-policy'], /object-src 'none'/);
  assert.match(response.headers['content-security-policy'], /upgrade-insecure-requests/);
  assert.ok(!response.headers['content-security-policy'].includes('unsafe-eval'));
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.body.version, '0.3.0');
});

test('SQL activation metrics handle mature cohorts and never infer historical activity', async (t) => {
  const { db } = setup(t, { seedDemo: false });
  db.prepare('INSERT INTO schools VALUES (?, ?, ?, ?, ?, 0)').run(
    's-metric',
    'Metric School',
    'metric school',
    'KZ',
    '',
  );
  db.prepare(
    'INSERT INTO teams (id, challenge_id, school_id, name, normalized_name, nickname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('t-metric', 'challenge-2026', 's-metric', 'Metric', 'metric', 'Student', '2026-01-01T00:00:00.000Z');
  for (const [type, at] of [
    ['team_created', '2026-01-01T00:00:00.000Z'],
    ['first_note', '2026-01-01T00:10:00.000Z'],
    ['activity', '2026-01-08T00:10:00.000Z'],
  ])
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(`e-${type}`, 't-metric', type, at);
  const metrics = calculateMetrics(db, false);
  assert.equal(metrics.activation.measuredTeams, 1);
  assert.ok(Math.abs(metrics.activation.medianFirstValueMinutes - 10) < 0.001);
  assert.equal(metrics.activation.d7Eligible, 1);
  assert.equal(metrics.activation.d7Returned, 1);
  assert.equal(metrics.activation.d7Percent, 100);
  assert.equal(calculateMetrics(db, true).funnel.total, 1);
});
