import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGUAGES, EN, EN_ERRORS, translate, translateError, format } from '../src/lib/i18n-dict.js';
import { STEPS, COUNTRIES } from '../server/lib.js';

// The student journey must survive a language switch. These tests guard the
// contract that makes localisation safe: Russian is the key and the fallback.

test('language switch falls back to Russian and never invents strings', () => {
  assert.deepEqual(LANGUAGES.map(([code]) => code), ['ru', 'en']);
  assert.equal(translate('Обзор', 'ru'), 'Обзор');
  assert.equal(translate('Обзор', 'en'), 'Overview');
  // Unknown key: show the Russian source rather than an empty label.
  assert.equal(translate('Строки которой нет в словаре', 'en'), 'Строки которой нет в словаре');
  // Unknown language and non-string input must be inert.
  assert.equal(translate('Обзор', 'kk'), 'Обзор');
  assert.equal(translate(undefined, 'en'), undefined);
  assert.equal(translate(42, 'en'), 42);
});

test('interpolation fills placeholders and leaves unknown ones alone', () => {
  assert.equal(format(translate('{done} из 5 этапов', 'en'), { done: 3 }), '3 of 5 stages');
  assert.equal(format('{a} и {b}', { a: 0 }), '0 и {b}');
  assert.equal(format('Пройдено {done} из 5 этапов. {next}', { done: 1, next: 'Дальше' }), 'Пройдено 1 из 5 этапов. Дальше');
});

test('server validation errors reach an English-speaking student in English', () => {
  assert.equal(translateError('Неверный код приглашения.', 'en'), 'Wrong invite code.');
  assert.equal(translateError('Нужна ссылка на домен aistartify.com.', 'en'), 'The link must point to aistartify.com.');
  assert.equal(translateError('Неверный код приглашения.', 'ru'), 'Неверный код приглашения.');
  // Unmapped server messages stay visible instead of disappearing.
  assert.equal(translateError('Неизвестная ошибка сервера', 'en'), 'Неизвестная ошибка сервера');
});

test('sprint steps and pilot countries ship an English block for every field', () => {
  assert.equal(STEPS.length, 5);
  for (const step of STEPS) {
    for (const field of ['title', 'short', 'description', 'prompt', 'example']) {
      assert.ok(step[field], `step ${step.index} lost its Russian ${field}`);
      assert.ok(step.en?.[field], `step ${step.index} has no English ${field}`);
      assert.ok(!/[А-Яа-яЁё]/.test(step.en[field]), `step ${step.index} English ${field} still contains Cyrillic`);
    }
  }
  assert.equal(COUNTRIES.length, 5);
  for (const country of COUNTRIES) {
    assert.ok(country.en?.name, `${country.code} has no English name`);
    assert.ok(!/[А-Яа-яЁё]/.test(country.en.name), `${country.code} English name still contains Cyrillic`);
  }
});

test('every string the student screens pass to t() has an English translation', () => {
  const files = [
    'src/App.jsx', 'src/components/UI.jsx', 'src/pages/Dashboard.jsx', 'src/pages/Join.jsx',
    'src/pages/Incubator.jsx', 'src/pages/League.jsx', 'src/pages/Showcase.jsx'
  ];
  const missing = new Set();
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt(?:f)?\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"([^"\\\n]*)")/g)) {
      const key = (match[1] ?? match[2]).replace(/\\'/g, "'").replace(/\\n/g, '\n');
      if (!/[А-Яа-яЁё]/.test(key)) continue; // already-English literals need no entry
      checked += 1;
      if (!EN[key]) missing.add(`${file}: ${key}`);
    }
  }
  assert.ok(checked > 250, `only ${checked} translated call sites found — the sweep looks incomplete`);
  assert.deepEqual([...missing], [], 'untranslated interface strings');
});

test('dictionary entries are usable translations, not placeholders', () => {
  const allowedCyrillic = new Set(['Русский']); // a language is named in its own tongue
  for (const [key, value] of Object.entries(EN)) {
    assert.equal(typeof value, 'string', `${key} is not a string`);
    assert.ok(value.trim().length > 0, `${key} translates to an empty string`);
    if (!allowedCyrillic.has(key)) {
      assert.ok(!/[А-Яа-яЁё]/.test(value), `${key} translation still contains Cyrillic: ${value}`);
    }
    // Placeholders must survive translation, otherwise the UI prints "{done}".
    const from = (key.match(/\{(\w+)\}/g) || []).sort();
    const to = (value.match(/\{(\w+)\}/g) || []).sort();
    assert.deepEqual(to, from, `${key} lost or renamed a placeholder`);
  }
  for (const [key, value] of Object.entries(EN_ERRORS)) {
    assert.ok(value.trim().length > 0 && !/[А-Яа-яЁё]/.test(value), `error not translated: ${key}`);
  }
});
