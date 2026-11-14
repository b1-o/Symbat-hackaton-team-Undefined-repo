import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePassportUrl, cleanText, countryName, median, hoursBetween, attentionReason, challengeSlug } from '../server/lib.js';

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

test('median handles empty, odd and even samples', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('hoursBetween returns null for invalid or reversed ranges', () => {
  assert.equal(hoursBetween(null, '2026-11-14T10:00:00Z'), null);
  assert.equal(hoursBetween('2026-11-14T10:00:00Z', '2026-11-14T09:00:00Z'), null);
  assert.equal(hoursBetween('2026-11-14T09:00:00Z', '2026-11-14T11:30:00Z'), 2.5);
});

test('attentionReason flags returned, not started and early teams', () => {
  assert.equal(attentionReason({ submission_status: 'approved' }), null);
  assert.equal(attentionReason({ submission_status: 'pending' }), null);
  assert.equal(attentionReason({ submission_status: 'returned' }), 'Проект возвращён на доработку');
  assert.equal(attentionReason({ started_at: null }), 'Команда ещё не начала спринт');
  assert.equal(attentionReason({ started_at: '2026-11-14T09:00:00Z', steps_completed: 1 }), 'Команда на раннем этапе');
  assert.equal(attentionReason({ started_at: '2026-11-14T09:00:00Z', steps_completed: 4, last_activity_at: new Date().toISOString() }), 'Проверьте готовность к публикации');
});

test('challengeSlug creates a usable slug', () => {
  assert.equal(challengeSlug('  Live Pilot Sprint  '), 'live-pilot-sprint');
  assert.equal(challengeSlug('!!!'), 'school-sprint');
});
