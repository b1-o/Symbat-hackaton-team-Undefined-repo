import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePassportUrl, cleanText, countryName, funnelModel, safeCsvCell, referralAttribution, projectReadiness, median, hoursBetween, attentionReason, challengeSlug } from '../server/lib.js';

test('normalizePassportUrl accepts canonical AI Startify passport URL', () => {
  const result = normalizePassportUrl('https://aistartify.com/startup/abc-123/');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://aistartify.com/startup/abc-123');
});

test('normalizePassportUrl strips www, query and hash', () => {
  const result = normalizePassportUrl('https://www.aistartify.com/startup/abc-123?utm=x#top');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://aistartify.com/startup/abc-123');
});

test('normalizePassportUrl rejects foreign domains and non-passport paths', () => {
  assert.equal(normalizePassportUrl('https://example.com/startup/abc').ok, false);
  assert.equal(normalizePassportUrl('https://aistartify.com/').ok, false);
  assert.equal(normalizePassportUrl('http://aistartify.com/startup/abc').ok, false);
  assert.equal(normalizePassportUrl('').ok, false);
});

test('cleanText trims and limits length', () => {
  assert.equal(cleanText('  hello  ', 3), 'hel');
  assert.equal(cleanText(null), '');
});

test('countryName maps known countries', () => {
  assert.equal(countryName('KZ'), 'Казахстан');
  assert.equal(countryName('XX'), 'XX');
});
test('passport rejects credentials, ports, lookalike hosts and javascript',()=>{
 for(const url of ['https://evil@aistartify.com/startup/x','https://aistartify.com:444/startup/x','https://aistartify.com.evil.example/startup/x','javascript:alert(1)']) assert.equal(normalizePassportUrl(url).ok,false);
});
test('funnel applies percentages sequentially and keeps baseline separate',()=>{
 const r=funnelModel({users:96000,teamSize:2,activation:80,completion:60,publication:65,approval:90});assert.equal(r.teams,48000);assert.equal(r.started,38400);assert.equal(r.completed,23040);assert.equal(r.submitted,14976);assert.equal(r.approved,13478);assert.equal(r.total,14045);assert.ok(Math.abs(r.conversion-14.04)<.01);assert.equal(funnelModel({users:0}).total,567);assert.equal(funnelModel({teamSize:3}).approved,8986);assert.equal(funnelModel({teamSize:1}).approved,26957);
});
test('CSV escapes quotes and neutralizes spreadsheet formulas',()=>{
 assert.equal(safeCsvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(safeCsvCell('  +SUM(1)'),'"\'  +SUM(1)"');assert.equal(safeCsvCell('hello'),'"hello"');
});
test('referrals require known, different school and readiness is evidence-based',()=>{
 assert.equal(referralAttribution([{schoolId:'a',referredBySchoolId:'b'},{schoolId:'b',referredBySchoolId:null},{schoolId:'c',referredBySchoolId:'c'},{schoolId:'d',referredBySchoolId:'unknown'}]),1);
 assert.equal(projectReadiness({steps:[{completed:true},{completed:false}]}).percent,20);
});

test('default HTTPS port is canonicalized',()=>{assert.equal(normalizePassportUrl('https://aistartify.com:443/startup/x').url,'https://aistartify.com/startup/x');});

test('median handles empty, odd and even samples',()=>{
 assert.equal(median([]),null);assert.equal(median([5]),5);assert.equal(median([9,1,5]),5);assert.equal(median([4,1,3,2]),2.5);
 const input=[3,1,2];median(input);assert.deepEqual(input,[3,1,2]);
});
test('hoursBetween is null-safe and never invents elapsed time',()=>{
 assert.equal(hoursBetween(null),null);assert.equal(hoursBetween('не дата'),null);
 assert.equal(hoursBetween('2026-11-14T00:00:00.000Z',new Date('2026-11-14T06:00:00.000Z').getTime()),6);
});
test('attention list ranks returned and ready-to-publish teams first',()=>{
 const now=new Date('2026-11-14T12:00:00.000Z').getTime();
 const day=offset=>new Date(now-offset*86400000).toISOString();
 assert.equal(attentionReason({stepsCompleted:5,submissionStatus:'approved'},now),null);
 assert.equal(attentionReason({stepsCompleted:4,submissionStatus:'returned'},now).code,'returned');
 assert.equal(attentionReason({stepsCompleted:4,submissionStatus:null},now).code,'ready');
 assert.equal(attentionReason({stepsCompleted:4,submissionStatus:'pending'},now).code,'review');
 assert.equal(attentionReason({stepsCompleted:0,startedAt:null,createdAt:day(2)},now).code,'not_started');
 assert.equal(attentionReason({stepsCompleted:0,startedAt:null,createdAt:day(0.2)},now),null);
 assert.equal(attentionReason({stepsCompleted:2,startedAt:day(4),lastActivityAt:day(3)},now).label,'Нет активности 3 дн.');
 assert.equal(attentionReason({stepsCompleted:2,startedAt:day(1),lastActivityAt:day(0.1)},now),null);
 const order=['returned','ready','not_started','idle','review'].map(code=>({returned:1,ready:2,not_started:3,idle:4,review:5}[code]));
 assert.deepEqual(order,[...order].sort((a,b)=>a-b));
});
test('challenge slug transliterates Cyrillic and stays URL-safe',()=>{
 assert.equal(challengeSlug('Проблема моей школы'),'problema-moei-shkoly');
 assert.equal(challengeSlug('  Осень 2026 · Алматы!  '),'osen-2026-almaty');
 assert.equal(challengeSlug('№5 ***'),'5');
 assert.equal(challengeSlug('№ *** '),'sprint');
 assert.equal(challengeSlug(''),'sprint');
 assert.match(challengeSlug('Қысқы спринт'),/^[a-z0-9-]+$/);
});
