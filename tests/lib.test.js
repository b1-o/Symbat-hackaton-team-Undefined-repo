import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePassportUrl, cleanText, countryName } from '../server/lib.js';

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
