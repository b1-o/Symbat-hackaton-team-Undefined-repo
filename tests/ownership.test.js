import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createLlmAdapter, readLlmConfig } from '../server/llm.js';

function setup(t, options = {}) {
  const db = createDatabase(':memory:', { seedDemo: options.seedDemo !== false });
  const llm = createLlmAdapter(readLlmConfig({ LLM_ENABLED: 'false' }));
  const app = createApp({ db, llm, demoMode: options.demoMode !== false, organizerPassword: 'test-password-123', inviteCode: 'TEST-CODE', ...options });
  t.after(() => db.close());
  return { db, app };
}
const cookie = res => res.headers['set-cookie'][0].split(';')[0];
const notes = 'Мы проверяем проблему потерянных вещей в школе. Пользователь — ученик, который ищет куртку после урока. Отделяем наблюдения от гипотез и записываем следующий шаг.';
async function completeSteps(agent) { for (let i = 1; i <= 4; i++) await agent.patch('/api/team/steps').send({ stepIndex: i, completed: true, content: notes }).expect(200); }
const fullChecklist = { accessible: true, original: true, safe: true, complete: true, ownership: true };

async function pilotTeam(app, name = 'Ownership Lab') {
  const created = await request(app).post('/api/teams').send({ accessCode: 'TEST-CODE', countryCode: 'KZ', schoolName: 'Pilot School', city: 'Almaty', teamName: name, nickname: 'Captain', consent: true, ageConfirmed: true }).expect(201);
  const agent = request.agent(app);
  await agent.post('/api/auth/team').send({ teamId: created.body.teamId, recoveryKey: created.body.recoveryKey }).expect(200);
  return { agent, ...created.body };
}

test('every team gets a readable unique ownership code, never reused', async t => {
  const { app, db } = setup(t);
  const codes = db.prepare('SELECT verification_code FROM teams').all().map(r => r.verification_code);
  assert.equal(codes.length, 6);
  assert.equal(new Set(codes).size, 6);
  for (const code of codes) assert.match(code, /^SS-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const a = await pilotTeam(app, 'First Team');
  const b = await pilotTeam(app, 'Second Team');
  const me = await a.agent.get('/api/team').expect(200);
  assert.equal(me.body.team.verificationCode, db.prepare('SELECT verification_code FROM teams WHERE id=?').get(a.teamId).verification_code);
  assert.notEqual(a.team.verificationCode, b.team.verificationCode);
  // The code is not a credential: it is published inside the passport on purpose.
  const boot = await request(app).get('/api/bootstrap').expect(200);
  assert.ok(!JSON.stringify(boot.body).includes(a.team.verificationCode), 'other teams codes are not public');
});

test('a real project cannot be approved until the reviewer finds the team code', async t => {
  const { app, db } = setup(t, { demoMode: false });
  const team = await pilotTeam(app);
  await completeSteps(team.agent);
  await team.agent.post('/api/team/submission').send({ title: 'LostFound', url: 'https://aistartify.com/startup/ownership-test', description: 'Помогаем школьникам находить потерянные вещи без публикации личных данных.', category: 'EdTech' }).expect(201);
  const org = await request(app).post('/api/auth/organizer').send({ password: 'test-password-123' }).expect(200);
  const orgCookie = cookie(org);
  const queue = await request(app).get('/api/organizer').set('Cookie', orgCookie).expect(200);
  const item = queue.body.pending.find(p => p.title === 'LostFound');
  assert.equal(item.verification_code, team.team.verificationCode);
  assert.equal(item.schoolIsDemo, false);
  const review = `/api/organizer/submissions/${item.id}/review`;
  // The four original checks are no longer enough for a real passport.
  const withoutOwnership = await request(app).post(review).set('Cookie', orgCookie).send({ decision: 'approve', checklist: { accessible: true, original: true, safe: true, complete: true } }).expect(400);
  assert.match(withoutOwnership.body.error, /код команды/i);
  assert.equal(db.prepare('SELECT status FROM submissions WHERE id=?').get(item.id).status, 'pending');
  await request(app).post(review).set('Cookie', orgCookie).send({ decision: 'approve', checklist: { ...fullChecklist, ownership: false } }).expect(400);
  await request(app).post(review).set('Cookie', orgCookie).send({ decision: 'approve', checklist: fullChecklist }).expect(200);
  const stored = JSON.parse(db.prepare('SELECT review_checklist FROM submissions WHERE id=?').get(item.id).review_checklist);
  assert.deepEqual(stored, fullChecklist, 'the audit trail records exactly what was checked');
  const showcase = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(showcase.body.projects.filter(p => p.title === 'LostFound').length, 1);
  assert.equal(showcase.body.projects[0].is_demo, false);
});

test('demo teams stay labelled and skip ownership, which cannot exist for a fake passport', async t => {
  const { app, db } = setup(t);
  const agent = request.agent(app);
  await agent.post('/api/demo/login').send({ role: 'team', teamId: 'team-eduquest' });
  await completeSteps(agent);
  await agent.post('/api/team/submission').send({ title: 'DemoOnly', url: 'https://aistartify.com/startup/demo-only-test', description: 'Учебная заявка демо-команды для проверки интерфейса очереди модерации.', category: 'EdTech' }).expect(201);
  assert.equal(db.prepare("SELECT is_demo FROM submissions WHERE title='DemoOnly'").get().is_demo, 1, 'a demo team cannot create an unlabelled submission');
  const org = await request(app).post('/api/demo/login').send({ role: 'organizer' }).expect(200);
  const orgCookie = cookie(org);
  const queue = await request(app).get('/api/organizer').set('Cookie', orgCookie).expect(200);
  const item = queue.body.pending.find(p => p.title === 'DemoOnly');
  assert.equal(item.schoolIsDemo, true);
  await request(app).post(`/api/organizer/submissions/${item.id}/review`).set('Cookie', orgCookie).send({ decision: 'approve', checklist: { accessible: true, original: true, safe: true, complete: true } }).expect(200);
  const stored = JSON.parse(db.prepare('SELECT review_checklist FROM submissions WHERE id=?').get(item.id).review_checklist);
  assert.equal(stored.ownership, undefined, 'we never record ownership proof for a passport that does not exist');
});

test('ownership code survives reset and appears in the audit export', async t => {
  const { app, db } = setup(t);
  const team = await pilotTeam(app);
  const org = await request(app).post('/api/demo/login').send({ role: 'organizer' }).expect(200);
  const orgCookie = cookie(org);
  await request(app).post('/api/demo/reset').set('Cookie', orgCookie).send({}).expect(200);
  assert.equal(db.prepare('SELECT verification_code FROM teams WHERE id=?').get(team.teamId).verification_code, team.team.verificationCode);
  const demoCodes = db.prepare('SELECT verification_code FROM teams WHERE id=?').get('team-eduquest').verification_code;
  assert.match(demoCodes, /^SS-/);
  const csv = await request(app).get('/api/organizer/export.csv').set('Cookie', orgCookie).expect(200);
  assert.match(csv.text, /Код владения/);
  assert.ok(csv.text.includes(team.team.verificationCode));
  const me = await team.agent.get('/api/team').expect(200);
  assert.equal(me.body.team.verificationCode, team.team.verificationCode);
});
