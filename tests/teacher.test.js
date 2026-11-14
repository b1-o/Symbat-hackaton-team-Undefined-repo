import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createLlmAdapter, readLlmConfig } from '../server/llm.js';

function setup(t, options = {}) {
  const db = createDatabase(':memory:', { seedDemo: options.seedDemo !== false });
  const llm = createLlmAdapter(readLlmConfig({ LLM_ENABLED: 'false' }));
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
async function login(app, role, extra = {}) {
  const res = await request(app)
    .post('/api/demo/login')
    .send({ role, ...extra })
    .expect(200);
  return cookie(res);
}
async function organizer(app) {
  return login(app, 'organizer');
}
const notes =
  'Мы проверяем проблему потерянных вещей в школе. Пользователь — ученик, который ищет свою куртку после урока. Записываем наблюдения и гипотезы отдельно.';
async function completeSteps(agent) {
  for (let i = 1; i <= 4; i++)
    await agent.patch('/api/team/steps').send({ stepIndex: i, completed: true, content: notes }).expect(200);
}
async function createTeam(app, fields = {}) {
  return request(app)
    .post('/api/teams')
    .send({
      accessCode: 'TEST-CODE',
      countryCode: 'KZ',
      schoolName: 'Pilot School',
      city: 'Almaty',
      teamName: 'Orbit Lab',
      nickname: 'Captain',
      consent: true,
      ageConfirmed: true,
      ...fields,
    })
    .expect(201);
}

test('teacher cabinet is scoped to one school and never exposes pupil notes', async (t) => {
  const { app } = setup(t);
  const kz = await login(app, 'teacher', { schoolId: 'school-kz-demo' });
  const uz = await login(app, 'teacher', { schoolId: 'school-uz-demo' });
  const data = await request(app).get('/api/teacher').set('Cookie', kz).expect(200);
  assert.equal(data.body.school.id, 'school-kz-demo');
  assert.deepEqual(data.body.teams.map((x) => x.name).sort(), ['EcoSchool', 'EduQuest']);
  assert.equal(data.body.funnel.total, 2);
  assert.equal(data.body.funnel.approved, 1);
  const other = await request(app).get('/api/teacher').set('Cookie', uz).expect(200);
  assert.deepEqual(other.body.teams.map((x) => x.name).sort(), ['SmartCampus', 'TechBridge']);
  // A coordinator sees progress and status, not the private workbook of a minor.
  const team = request.agent(app);
  await team.post('/api/demo/login').send({ role: 'team', teamId: 'team-eduquest' });
  await team
    .patch('/api/team/workbook')
    .send({ stepIndex: 1, content: 'Секретный черновик ученика' })
    .expect(200);
  const after = await request(app).get('/api/teacher').set('Cookie', kz).expect(200);
  assert.ok(!JSON.stringify(after.body).includes('Секретный'));
  await request(app).get('/api/organizer').set('Cookie', kz).expect(401);
  await request(app).get('/api/team').set('Cookie', kz).expect(401);
  await request(app).get('/api/teacher').expect(401);
});

test('organizer issues a coordinator key; login, rotation and revocation work', async (t) => {
  const { app, db } = setup(t, { demoMode: false });
  const created = await createTeam(app);
  const schoolId = db.prepare('SELECT school_id FROM teams WHERE id=?').get(created.body.teamId).school_id;
  const org = await request(app)
    .post('/api/auth/organizer')
    .send({ password: 'test-password-123' })
    .expect(200);
  const orgCookie = cookie(org);
  await request(app)
    .post(`/api/organizer/schools/${schoolId}/coordinator`)
    .send({ coordinatorName: 'Координатор' })
    .expect(401);
  const issued = await request(app)
    .post(`/api/organizer/schools/${schoolId}/coordinator`)
    .set('Cookie', orgCookie)
    .send({ coordinatorName: 'Координатор' })
    .expect(201);
  const key = issued.body.coordinatorKey;
  assert.ok(key.length >= 20);
  assert.notEqual(db.prepare('SELECT access_hash FROM schools WHERE id=?').get(schoolId).access_hash, key);
  await request(app).post('/api/auth/teacher').send({ schoolId, coordinatorKey: 'wrong' }).expect(401);
  const first = await request(app)
    .post('/api/auth/teacher')
    .send({ schoolId, coordinatorKey: key })
    .expect(200);
  const me = await request(app).get('/api/me').set('Cookie', cookie(first)).expect(200);
  assert.equal(me.body.role, 'teacher');
  assert.equal(me.body.school.id, schoolId);
  const listed = await request(app).get('/api/organizer/schools').set('Cookie', orgCookie).expect(200);
  assert.equal(listed.body.schools[0].hasCoordinatorKey, true);
  assert.ok(!JSON.stringify(listed.body).includes('access_hash'));
  const rotated = await request(app)
    .post('/api/teacher/rotate-key')
    .set('Cookie', cookie(first))
    .send({})
    .expect(200);
  assert.notEqual(rotated.body.coordinatorKey, key);
  await request(app).post('/api/auth/teacher').send({ schoolId, coordinatorKey: key }).expect(401);
  await request(app)
    .post('/api/auth/teacher')
    .send({ schoolId, coordinatorKey: rotated.body.coordinatorKey })
    .expect(200);
  // Re-issuing from the organizer revokes existing coordinator sessions.
  await request(app)
    .post(`/api/organizer/schools/${schoolId}/coordinator`)
    .set('Cookie', orgCookie)
    .send({})
    .expect(201);
  await request(app).get('/api/teacher').set('Cookie', cookie(first)).expect(401);
});

test('reminder reaches only its own team, is acknowledged once and cannot be spammed', async (t) => {
  const { app, db } = setup(t);
  const teacher = await login(app, 'teacher', { schoolId: 'school-kz-demo' });
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-smartcampus', message: 'Чужая школа' })
    .expect(404);
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest', message: 'кор' })
    .expect(400);
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest' })
    .expect(400);
  const sent = await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest', message: 'Проверьте этап интервью и запишите выводы.' })
    .expect(201);
  assert.equal(sent.body.reminders.sent, 2); // one seeded demo reminder + this one
  const reminderId = db
    .prepare(
      "SELECT id FROM reminders WHERE team_id='team-eduquest' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get().id;
  const teamAgent = request.agent(app);
  await teamAgent.post('/api/demo/login').send({ role: 'team', teamId: 'team-eduquest' });
  const mine = await teamAgent.get('/api/team').expect(200);
  assert.equal(mine.body.team.reminders.filter((r) => !r.readAt).length, 2);
  const otherAgent = request.agent(app);
  await otherAgent.post('/api/demo/login').send({ role: 'team', teamId: 'team-studylab' });
  const others = await otherAgent.get('/api/team').expect(200);
  assert.equal(others.body.reminders, undefined);
  assert.equal(others.body.team.reminders.length, 0);
  await otherAgent.post(`/api/team/reminders/${reminderId}/read`).send({}).expect(404);
  await teamAgent.post(`/api/team/reminders/${reminderId}/read`).send({}).expect(200);
  await teamAgent.post(`/api/team/reminders/${reminderId}/read`).send({}).expect(200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE type='reminder_read'").get().c, 2);
  const afterRead = await request(app).get('/api/teacher').set('Cookie', teacher).expect(200);
  assert.equal(afterRead.body.teams.find((x) => x.id === 'team-eduquest').unreadReminders, 1);
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest', message: 'Второе напоминание команды' })
    .expect(201);
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest', message: 'Третье напоминание команды' })
    .expect(201);
  await request(app)
    .post('/api/teacher/reminders')
    .set('Cookie', teacher)
    .send({ teamId: 'team-eduquest', message: 'Четвёртое подряд не пройдёт' })
    .expect(409);
  const org = await organizer(app);
  await request(app)
    .post('/api/organizer/reminders')
    .set('Cookie', org)
    .send({ teamId: 'team-studylab', message: 'Организатор напоминает про спринт.' })
    .expect(201);
  const orgData = await request(app).get('/api/organizer').set('Cookie', org).expect(200);
  assert.equal(orgData.body.reminders.sent, 5);
  assert.equal(orgData.body.reminders.read, 1);
});

test('attention list surfaces stuck and ready teams for teacher and organizer', async (t) => {
  const { app, db } = setup(t);
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  db.prepare('UPDATE teams SET created_at=?, started_at=NULL WHERE id=?').run(old, 'team-studylab');
  // EduQuest finishes preparation but has not published a passport yet.
  for (const step of [2, 3, 4])
    db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run('team-eduquest', step, new Date().toISOString());
  const teacher = await login(app, 'teacher', { schoolId: 'school-kg-demo' });
  const data = await request(app).get('/api/teacher').set('Cookie', teacher).expect(200);
  const study = data.body.attention.find((x) => x.id === 'team-studylab');
  assert.equal(study.reason.code, 'not_started');
  const kz = await login(app, 'teacher', { schoolId: 'school-kz-demo' });
  const kzData = await request(app).get('/api/teacher').set('Cookie', kz).expect(200);
  assert.equal(kzData.body.attention.find((x) => x.id === 'team-eduquest').reason.code, 'ready');
  const org = await organizer(app);
  const orgData = await request(app).get('/api/organizer').set('Cookie', org).expect(200);
  assert.ok(orgData.body.attention.length >= 2);
  assert.ok(
    orgData.body.attention.every((item, i, arr) => !i || arr[i - 1].reason.priority <= item.reason.priority),
  );
  assert.ok(!orgData.body.attention.some((x) => x.submissionStatus === 'approved'));
  const csv = await request(app).get('/api/organizer/export.csv').set('Cookie', org).expect(200);
  assert.match(csv.text, /Нужна помощь/);
  assert.match(csv.text, /Готовы опубликовать паспорт/);
});

test('invite links count openings and unique daily visitors without storing raw identifiers', async (t) => {
  const { app, db } = setup(t);
  await request(app).post('/api/invite/click').send({ schoolId: 'school-kz-demo' }).expect(201);
  await request(app).post('/api/invite/click').send({ schoolId: 'school-kz-demo' }).expect(201);
  await request(app)
    .post('/api/invite/click')
    .set('User-Agent', 'another-device')
    .send({ schoolId: 'school-kz-demo' })
    .expect(201);
  await request(app).post('/api/invite/click').send({ schoolId: 'missing-school' }).expect(404);
  await request(app).post('/api/invite/click').send({ challengeId: 'missing-season' }).expect(404);
  const teacher = await login(app, 'teacher', { schoolId: 'school-kz-demo' });
  const data = await request(app).get('/api/teacher').set('Cookie', teacher).expect(200);
  assert.equal(data.body.invites.clicks, 3);
  assert.equal(data.body.invites.visitors, 2);
  assert.equal(data.body.invites.teamsFromInvite, 2);
  const stored = db.prepare('SELECT * FROM invite_clicks').all();
  assert.ok(stored.every((r) => /^[a-f0-9]{64}$/.test(r.visitor_hash)));
  assert.ok(!JSON.stringify(stored).includes('another-device'));
  const org = await organizer(app);
  const orgData = await request(app).get('/api/organizer').set('Cookie', org).expect(200);
  assert.equal(orgData.body.invites.clicks, 3);
});

test('seasons are isolated: separate codes, scoped league and protected last active season', async (t) => {
  const { app, db } = setup(t);
  const org = await organizer(app);
  const created = await request(app)
    .post('/api/organizer/challenges')
    .set('Cookie', org)
    .send({ title: 'Весенний спринт', days: 14 })
    .expect(201);
  const season = created.body.challenge;
  assert.equal(season.slug, 'vesennii-sprint');
  assert.ok(created.body.accessCode.length >= 6);
  await request(app).post('/api/organizer/challenges').set('Cookie', org).send({ title: 'x' }).expect(400);
  await request(app).post('/api/organizer/challenges').send({ title: 'Без прав' }).expect(401);
  const duplicate = await request(app)
    .post('/api/organizer/challenges')
    .set('Cookie', org)
    .send({ title: 'Весенний спринт' })
    .expect(201);
  assert.equal(duplicate.body.challenge.slug, 'vesennii-sprint-2');
  const boot = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(boot.body.challenges.length, 3);
  assert.ok(boot.body.challenges.every((c) => c.access_code === undefined));
  // The newest season becomes the default; the old one stays reachable by slug.
  const scoped = await request(app).get(`/api/bootstrap?challenge=${season.id}`).expect(200);
  assert.equal(scoped.body.challenge.id, season.id);
  assert.equal(scoped.body.stats.teams, 0);
  assert.equal(scoped.body.leaderboard.schools.length, 0);
  assert.equal(scoped.body.projects.length, 0);
  const bySlug = await request(app).get('/api/bootstrap?challenge=school-sprint-2026').expect(200);
  assert.equal(bySlug.body.stats.teams, 6);
  await request(app).get('/api/bootstrap?challenge=nope').expect(404);
  const fields = {
    countryCode: 'KZ',
    schoolName: 'Season School',
    teamName: 'Season Team',
    nickname: 'Nick',
    consent: true,
    ageConfirmed: true,
  };
  await request(app)
    .post('/api/teams')
    .send({ ...fields, challengeId: season.id, accessCode: 'TEST-CODE' })
    .expect(400);
  const joined = await request(app)
    .post('/api/teams')
    .send({ ...fields, challengeId: season.id, accessCode: created.body.accessCode })
    .expect(201);
  assert.equal(
    db.prepare('SELECT challenge_id FROM teams WHERE id=?').get(joined.body.teamId).challenge_id,
    season.id,
  );
  const seasonOrg = await request(app)
    .get(`/api/organizer?challenge=${season.id}`)
    .set('Cookie', org)
    .expect(200);
  assert.equal(seasonOrg.body.funnel.total, 1);
  const allOrg = await request(app).get('/api/organizer').set('Cookie', org).expect(200);
  assert.equal(allOrg.body.funnel.total, 7);
  await request(app)
    .patch(`/api/organizer/challenges/${season.id}`)
    .set('Cookie', org)
    .send({ status: 'archived' })
    .expect(200);
  await request(app).get(`/api/bootstrap?challenge=${season.id}`).expect(404);
  await request(app)
    .post('/api/teams')
    .send({ ...fields, teamName: 'Late Team', challengeId: season.id, accessCode: created.body.accessCode })
    .expect(404);
  const remaining = db.prepare("SELECT id FROM challenges WHERE status='active'").all();
  for (const c of remaining.slice(1))
    await request(app)
      .patch(`/api/organizer/challenges/${c.id}`)
      .set('Cookie', org)
      .send({ status: 'archived' })
      .expect(200);
  await request(app)
    .patch(`/api/organizer/challenges/${remaining[0].id}`)
    .set('Cookie', org)
    .send({ status: 'archived' })
    .expect(409);
  await request(app)
    .patch(`/api/organizer/challenges/${remaining[0].id}`)
    .set('Cookie', org)
    .send({ status: 'wrong' })
    .expect(400);
});

test('demo reset restores labelled rows and keeps the live pilot and its season intact', async (t) => {
  const { app, db } = setup(t);
  const org = await organizer(app);
  const created = await request(app)
    .post('/api/organizer/challenges')
    .set('Cookie', org)
    .send({ title: 'Живой пилот школы', days: 10 })
    .expect(201);
  const live = await createTeam(app, {
    challengeId: created.body.challenge.id,
    accessCode: created.body.accessCode,
    teamName: 'Live Pilot Team',
    schoolName: 'Live Pilot School',
  });
  const liveAgent = request.agent(app);
  await liveAgent
    .post('/api/auth/team')
    .send({ teamId: live.body.teamId, recoveryKey: live.body.recoveryKey })
    .expect(200);
  await liveAgent
    .patch('/api/team/workbook')
    .send({ stepIndex: 1, content: 'Настоящая заметка пилотной команды.' })
    .expect(200);
  // A live team referred by a demo school must survive the demo wipe.
  db.prepare('UPDATE teams SET referred_by_school_id=? WHERE id=?').run('school-kz-demo', live.body.teamId);
  const demoTeam = request.agent(app);
  await demoTeam.post('/api/demo/login').send({ role: 'team', teamId: 'team-eduquest' });
  await demoTeam
    .patch('/api/team/workbook')
    .send({ stepIndex: 2, content: 'Изменение в демо-команде, которое сброс должен стереть.' })
    .expect(200);
  await request(app).post('/api/demo/reset').send({}).expect(401);
  const reset = await request(app).post('/api/demo/reset').set('Cookie', org).send({}).expect(200);
  assert.equal(reset.body.seededTeams, 6);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM teams').get().c, 7);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schools').get().c, 4);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM challenges').get().c, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='approved'").get().c, 2);
  const survivor = await liveAgent.get('/api/team').expect(200);
  assert.equal(survivor.body.team.name, 'Live Pilot Team');
  assert.match(survivor.body.team.steps[0].content, /Настоящая заметка/);
  assert.equal(survivor.body.team.referredBySchoolId, 'school-kz-demo');
  const refreshed = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(refreshed.body.stats.verified, 2);
  const demoAgent = request.agent(app);
  await demoAgent.post('/api/demo/login').send({ role: 'team', teamId: 'team-eduquest' });
  const demoRestored = await demoAgent.get('/api/team').expect(200);
  assert.equal(demoRestored.body.team.steps[1].content, '');
});

test('production mode hides demo teacher login, demo reset and demo schools', async (t) => {
  const { app } = setup(t, { demoMode: false });
  await request(app).post('/api/demo/login').send({ role: 'teacher' }).expect(404);
  const org = await request(app)
    .post('/api/auth/organizer')
    .send({ password: 'test-password-123' })
    .expect(200);
  await request(app).post('/api/demo/reset').set('Cookie', cookie(org)).send({}).expect(404);
  const schools = await request(app).get('/api/organizer/schools').set('Cookie', cookie(org)).expect(200);
  assert.equal(schools.body.schools.length, 0);
  await request(app).post('/api/invite/click').send({ schoolId: 'school-kz-demo' }).expect(404);
  const boot = await request(app).get('/api/bootstrap').expect(200);
  assert.deepEqual(boot.body.demoSchools, []);
});
