import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase, DEMO_CHALLENGE_ID, DEMO_TEAM_ID } from '../server/db.js';
import { createApp } from '../server/app.js';

test('Startify Sprint API', async (t) => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, frontend: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(path, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    const setCookie = response.headers.get('set-cookie')?.split(';')[0];
    return { status: response.status, json, cookie: setCookie || cookie };
  }

  t.after(() => {
    server.close();
    db.close();
  });

  let organizerCookie;
  let liveChallenge;
  let liveTeam;
  let liveTeamCookie;

  await t.test('default bootstrap is the isolated demo challenge', async () => {
    const { status, json } = await req('/api/bootstrap');
    assert.equal(status, 200);
    assert.equal(json.challenge.id, DEMO_CHALLENGE_ID);
    assert.equal(json.challenge.is_demo, 1);
    assert.equal(json.stats.teams, 6);
    assert.equal(json.stats.verified, 2);
  });

  await t.test('organizer can create a live pilot challenge', async () => {
    const login = await req('/api/demo/login', { method: 'POST', body: { role: 'organizer' } });
    organizerCookie = login.cookie;
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const created = await req('/api/organizer/challenges', {
      method: 'POST',
      cookie: organizerCookie,
      body: { title: 'Live Pilot Sprint', description: 'Test pilot', accessCode: 'PILOT-TEST', startsAt, endsAt }
    });
    assert.equal(created.status, 201);
    liveChallenge = created.json.challenge;
    assert.equal(liveChallenge.is_demo, 0);

    const empty = await req(`/api/bootstrap?challenge=${liveChallenge.id}`);
    assert.equal(empty.json.stats.teams, 0);
    assert.equal(empty.json.stats.verified, 0);
  });

  await t.test('live team join, reminder, invite analytics and publication stay scoped', async () => {
    const joined = await req('/api/teams', {
      method: 'POST',
      body: {
        challengeId: liveChallenge.id,
        accessCode: 'PILOT-TEST',
        countryCode: 'KZ',
        schoolName: 'Live School',
        city: 'Almaty',
        teamName: 'Live Team',
        nickname: 'Tester'
      }
    });
    assert.equal(joined.status, 201);
    liveTeam = joined.json.team;
    liveTeamCookie = joined.cookie;
    assert.equal(liveTeam.isDemo, false);

    const reminded = await req(`/api/teams/${liveTeam.id}/reminder`, { method: 'POST', cookie: organizerCookie, body: {} });
    assert.equal(reminded.status, 201);
    const me = await req('/api/me', { cookie: liveTeamCookie });
    assert.equal(me.json.team.reminders.length, 1);
    const read = await req(`/api/team/reminders/${me.json.team.reminders[0].id}/read`, { method: 'POST', cookie: liveTeamCookie });
    assert.equal(read.json.team.reminders.length, 0);

    const click = await req('/api/invites/click', {
      method: 'POST',
      body: { challengeId: liveChallenge.id, fromSchoolId: liveTeam.school.id }
    });
    assert.equal(click.status, 201);

    const submitted = await req('/api/team/submission', {
      method: 'POST',
      cookie: liveTeamCookie,
      body: { title: 'Live Project', url: 'https://aistartify.com/startup/live-test-1', description: 'Live test' }
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.json.team.submission.status, 'pending');

    const orgBefore = await req(`/api/organizer?challenge=${liveChallenge.id}`, { cookie: organizerCookie });
    const pending = orgBefore.json.pending.find((item) => item.title === 'Live Project');
    assert.ok(pending);
    const approved = await req(`/api/organizer/submissions/${pending.id}/review`, {
      method: 'POST',
      cookie: organizerCookie,
      body: { decision: 'approve' }
    });
    assert.equal(approved.status, 200);

    const live = await req(`/api/bootstrap?challenge=${liveChallenge.id}`);
    assert.equal(live.json.stats.verified, 1);
    assert.equal(live.json.leaderboard.schools.length, 1);
    assert.equal(live.json.leaderboard.schools[0].name, 'Live School');

    const demo = await req(`/api/bootstrap?challenge=${DEMO_CHALLENGE_ID}`);
    assert.equal(demo.json.stats.verified, 2);
    assert.equal(demo.json.stats.teams, 6);

    const org = await req(`/api/organizer?challenge=${liveChallenge.id}`, { cookie: organizerCookie });
    assert.equal(org.json.growth.inviteClicks, 1);
    assert.equal(org.json.growth.remindersSent, 1);
    assert.equal(org.json.funnel.approved, 1);
  });

  await t.test('duplicate passport URL is rejected for another team', async () => {
    const second = await req('/api/teams', {
      method: 'POST',
      body: {
        challengeId: liveChallenge.id,
        accessCode: 'PILOT-TEST',
        countryCode: 'KZ',
        schoolName: 'Live School',
        city: 'Almaty',
        teamName: 'Second Team',
        nickname: 'Tester2'
      }
    });
    assert.equal(second.status, 201);
    const duplicate = await req('/api/team/submission', {
      method: 'POST',
      cookie: second.cookie,
      body: { title: 'Duplicate', url: 'https://www.aistartify.com/startup/live-test-1?utm=x' }
    });
    assert.equal(duplicate.status, 409);
  });

  await t.test('teacher is scoped to their school and can remind a stuck demo team', async () => {
    const teacher = await req('/api/demo/login', { method: 'POST', body: { role: 'teacher' } });
    const data = await req(`/api/teacher?challenge=${DEMO_CHALLENGE_ID}`, { cookie: teacher.cookie });
    assert.equal(data.status, 200);
    assert.equal(data.json.school.id, 'school-kz-demo');
    assert.ok(data.json.teams.every((team) => team.school_id === 'school-kz-demo'));
    assert.ok(data.json.attention.some((team) => team.id === DEMO_TEAM_ID));

    const forbidden = await req(`/api/teams/${liveTeam.id}/reminder`, { method: 'POST', cookie: teacher.cookie, body: {} });
    assert.equal(forbidden.status, 403);

    const allowed = await req(`/api/teams/${DEMO_TEAM_ID}/reminder`, { method: 'POST', cookie: teacher.cookie, body: {} });
    assert.equal(allowed.status, 201);
    const teamLogin = await req('/api/demo/login', { method: 'POST', body: { role: 'team', teamId: DEMO_TEAM_ID } });
    const me = await req('/api/me', { cookie: teamLogin.cookie });
    assert.ok(me.json.team.reminders.length >= 2);
  });

  await t.test('demo reset restores demo seed without touching live pilot data', async () => {
    const reset = await req('/api/demo/reset', { method: 'POST', cookie: organizerCookie });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.bootstrap.challenge.id, DEMO_CHALLENGE_ID);
    assert.equal(reset.json.bootstrap.stats.teams, 6);
    assert.equal(reset.json.bootstrap.stats.verified, 2);

    const live = await req(`/api/bootstrap?challenge=${liveChallenge.id}`);
    assert.equal(live.json.stats.teams, 2);
    assert.equal(live.json.stats.verified, 1);
    assert.equal(live.json.leaderboard.schools[0].name, 'Live School');
  });

  await t.test('invalid passport URL is rejected', async () => {
    const login = await req('/api/demo/login', { method: 'POST', body: { role: 'team', teamId: DEMO_TEAM_ID } });
    const invalid = await req('/api/team/submission', {
      method: 'POST',
      cookie: login.cookie,
      body: { title: 'Bad URL', url: 'https://example.com/startup/x' }
    });
    assert.equal(invalid.status, 400);
  });
});
