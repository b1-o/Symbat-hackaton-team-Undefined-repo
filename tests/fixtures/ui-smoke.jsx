import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import Teacher from '../../src/pages/Teacher.jsx';
import Organizer from '../../src/pages/Organizer.jsx';
import Incubator from '../../src/pages/Incubator.jsx';
import Strategy from '../../src/pages/Strategy.jsx';

const iso = new Date().toISOString();
const steps = [1, 2, 3, 4, 5].map(i => ({ index: i, title: `Этап ${i}`, short: 'Шаг', description: 'Описание', prompt: 'Вопрос наставника', example: 'Пример', icon: 'lightbulb', completed: i < 3, content: 'Сохранённые заметки', updatedAt: iso }));
const challenge = { id: 'challenge-2026', slug: 'school-sprint-2026', title: 'Сезон 2026', status: 'active', isOpen: true, starts_at: iso, ends_at: iso };
const bootstrap = {
  demoMode: true, inviteHint: 'SPRINT-2026', llm: { enabled: false, model: null },
  countries: [{ code: 'KZ', flag: '🇰🇿', name: 'Казахстан' }], categories: ['EdTech'], steps,
  challenge, challenges: [challenge, { ...challenge, id: 'challenge-2', slug: 'winter', title: 'Зимний спринт' }],
  schools: [{ id: 'school-kz-demo', name: 'Демо-лицей №1', country_code: 'KZ', is_demo: 1 }],
  projects: [], demoTeams: [], demoSchools: [], leaderboard: { schools: [], countries: [] },
  stats: { teams: 6, schools: 3, countries: 3, verified: 2 }
};
const cabinet = {
  school: { id: 'school-kz-demo', name: 'Демо-лицей №1', city: 'Алматы', country_code: 'KZ', countryName: 'Казахстан', is_demo: true, coordinator_name: 'Демо-координатор', hasCoordinatorKey: false },
  funnel: { total: 2, started: 2, submitted: 1, approved: 1, pending: 0, returned: 0, conversion: 50 },
  teams: [
    { id: 'team-ecoschool', name: 'EcoSchool', nickname: 'Аружан', createdAt: iso, startedAt: iso, lastActivityAt: iso, stepsCompleted: 5, submissionStatus: 'approved', submissionTitle: 'EcoTrack', idleHours: 1, unreadReminders: 0, remindersSent: 0, reason: null },
    { id: 'team-eduquest', name: 'EduQuest', nickname: 'Данияр', createdAt: iso, startedAt: iso, lastActivityAt: iso, stepsCompleted: 4, submissionStatus: null, idleHours: 2, unreadReminders: 1, remindersSent: 1, reason: { code: 'ready', label: 'Готовы опубликовать паспорт', tone: 'purple', priority: 2 } }
  ],
  attention: [{ id: 'team-eduquest', name: 'EduQuest', nickname: 'Данияр', stepsCompleted: 4, submissionStatus: null, unreadReminders: 1, reason: { code: 'ready', label: 'Готовы опубликовать паспорт', tone: 'purple', priority: 2 } }],
  rank: { rank: 1 }, invites: { clicks: 12, visitors: 7, teamsFromInvite: 2 },
  reminders: { sent: 1, unread: 1, presets: ['Опубликуйте паспорт и отправьте ссылку.'] },
  schools: [{ id: 'school-uz-demo', name: 'Демо-школа №2', countryName: 'Узбекистан', verified: 1, isDemo: true }]
};
const organizerPayload = {
  funnel: { total: 6, started: 5, submitted: 4, approved: 2, pending: 2, returned: 0, conversion: 33.3 },
  teams: [{ id: 'team-eduquest', name: 'EduQuest', nickname: 'Данияр', school_name: 'Демо-лицей №1', countryName: 'Казахстан', steps_completed: 4, submission_status: null, is_demo: true, created_at: iso }],
  pending: [{ id: 'sub-live', title: 'LostFound', url: 'https://aistartify.com/startup/live-test', description: 'Реальный пилотный проект школы.', team_name: 'Orbit Lab', school_name: 'Pilot School', countryName: 'Казахстан', is_demo: false, schoolIsDemo: false, verification_code: 'SS-ABCD2345', steps: [1, 2, 3, 4], workbook: [{ step_index: 1, content: 'Заметки команды' }], created_at: iso }], includeDemo: true, challengeId: null,
  attention: [{ id: 'team-eduquest', name: 'EduQuest', schoolName: 'Демо-лицей №1', isDemo: true, stepsCompleted: 4, reason: { code: 'ready', label: 'Готовы опубликовать паспорт', tone: 'purple', priority: 2 } }],
  referrals: 2, referralsApproved: 0,
  usage: { requests: 0, llm_success: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: null },
  invites: { clicks: 12, visitors: 7 },
  reminders: { sent: 1, read: 0, presets: ['Опубликуйте паспорт и отправьте ссылку.'] },
  activation: { medianFirstValueMinutes: null, measuredTeams: 0, d7Eligible: 0, d7Returned: 0, d7Percent: null }
};
const schoolsPayload = { schools: [{ id: 'school-kz-demo', name: 'Демо-лицей №1', countryName: 'Казахстан', is_demo: true, teams: 2, verified: 1, hasCoordinatorKey: false, coordinator_name: '' }] };
const team = {
  id: 'team-eduquest', name: 'EduQuest', nickname: 'Данияр', isDemo: true, xp: 200, nextStep: 3, createdAt: iso,
  school: { id: 'school-kz-demo', name: 'Демо-лицей №1', countryName: 'Казахстан', countryCode: 'KZ' },
  challenge: { id: challenge.id, title: challenge.title, endsAt: iso }, steps, submission: null, verificationCode: 'SS-EDUQ2345',
  reminders: [{ id: 'r1', message: 'Проверьте этап интервью и запишите выводы.', authorRole: 'teacher', createdAt: iso, readAt: null }]
};

export async function run() {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    const payload = url.startsWith('/api/teacher') ? cabinet
      : url.startsWith('/api/organizer/schools') ? schoolsPayload
      : url.startsWith('/api/organizer') ? organizerPayload
      : url.startsWith('/api/team/mentor') ? { messages: [] }
      : url.startsWith('/api/team/reminders') ? { team }
      : bootstrap;
    return { ok: true, status: 200, json: async () => payload };
  };
  const noop = () => {};
  const ctx = { data: bootstrap, refresh: async () => {}, navigate: noop, notify: noop, demoLogin: noop };
  async function mount(name, element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(element); });
    await act(async () => { await Promise.resolve(); });
    const text = host.textContent;
    assert.ok(text.length > 200, `${name}: nothing rendered`);
    assert.ok(!text.includes('Загружаем кабинет'), `${name}: stuck on loading`);
    return { host, text, root };
  }

  const teacher = await mount('teacher cabinet', <Teacher {...ctx} me={{ role: 'teacher', school: cabinet.school }} />);
  assert.ok(calls.some(c => c.url === '/api/teacher'), 'teacher cabinet did not load its data');
  for (const expected of ['Демо-лицей №1', 'Кому помочь сегодня', 'Готовы опубликовать паспорт', 'EcoSchool', 'EduQuest', 'Открытий ссылки', 'Команды школы']) {
    assert.ok(teacher.text.includes(expected), `teacher cabinet missing "${expected}"`);
  }
  assert.ok(!teacher.text.includes('Сохранённые заметки'), 'coordinator must not see pupil notes');
  const remindButtons = [...teacher.host.querySelectorAll('button')].filter(b => b.textContent.includes('Напомнить'));
  assert.ok(remindButtons.length >= 1, 'no reminder action rendered');
  await act(async () => { remindButtons[0].click(); });
  assert.ok(teacher.host.textContent.includes('Напоминание команде'), 'reminder modal did not open');
  const preset = [...teacher.host.querySelectorAll('.preset')][0];
  await act(async () => { preset.click(); });
  const textarea = teacher.host.querySelector('textarea');
  assert.ok(textarea.value.length > 5, 'preset did not fill the reminder text');
  await act(async () => { teacher.host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(calls.some(c => c.url === '/api/teacher/reminders' && c.method === 'POST'), 'reminder was not sent');

  const org = await mount('organizer cabinet', <Organizer {...ctx} me={{ role: 'organizer' }} />);
  for (const expected of ['Кому помочь сейчас', 'Координаторы школ', 'Сезоны спринта', 'Сбросить демо', 'Открытий приглашений', 'Зимний спринт']) {
    assert.ok(org.text.includes(expected), `organizer cabinet missing "${expected}"`);
  }
  assert.ok(org.text.includes('SS-ABCD2345'), 'reviewer does not see the expected ownership code');
  const labels = [...org.host.querySelectorAll('.review-checks label')].map(l => l.textContent);
  assert.equal(labels.length, 5, 'a real project needs the ownership checkbox on top of the four original ones');
  assert.ok(labels.some(l => l.includes('SS-ABCD2345')), 'ownership checkbox does not name the code');
  const approve = [...org.host.querySelectorAll('button')].find(b => b.textContent.includes('Подтвердить публикацию'));
  assert.ok(approve.disabled, 'approve must stay disabled until every check is ticked');
  await act(async () => { for (const box of org.host.querySelectorAll('.review-checks input')) { box.click(); } });
  assert.ok(!approve.disabled, 'approve should unlock once all five checks are ticked');

  const issue = [...org.host.querySelectorAll('button')].find(b => b.textContent.includes('Выдать ключ'));
  await act(async () => { issue.click(); });
  assert.ok(calls.some(c => c.url.includes('/coordinator') && c.method === 'POST'), 'coordinator key was not requested');

  const strategy = await mount('strategy', <Strategy {...ctx} me={{ role: 'guest' }} />);
  const deadlineTab = [...strategy.host.querySelectorAll('[role="tab"]')].find(b => b.textContent.includes('Дедлайн 31.12'));
  assert.ok(deadlineTab, 'deadline tab is missing');
  await act(async () => { deadlineTab.click(); });
  for (const expected of ['дней до дедлайна', 'Недостижимо в этот срок', 'Что должно быть правдой', 'НАШЕ ОБЯЗАТЕЛЬСТВО ДО 31.12', 'ТРЕБУЕТ ЦЕЛЬ', 'ВЫДЕРЖИТ КАНАЛ']) {
    assert.ok(strategy.host.textContent.includes(expected), `deadline tab missing "${expected}"`);
  }
  const national = [...strategy.host.querySelectorAll('.deadline-presets button')].find(b => b.textContent.includes('Национальный'));
  await act(async () => { national.click(); });
  assert.ok(strategy.host.textContent.includes('Арифметика сходится'), 'preset did not flip the verdict to reachable');
  const organic = [...strategy.host.querySelectorAll('.deadline-presets button')].find(b => b.textContent.includes('Органический'));
  await act(async () => { organic.click(); });
  assert.ok(strategy.host.textContent.includes('Недостижимо в этот срок'), 'preset did not flip the verdict back');

  const incubator = await mount('incubator', <Incubator {...ctx} me={{ role: 'team', team }} />);
  assert.ok(incubator.text.includes('Проверьте этап интервью'), 'team does not see the reminder');
  const publicationTab = [...incubator.host.querySelectorAll('.workspace-tabs button')].find(b => b.textContent.includes('Этап 5'));
  assert.ok(publicationTab, 'publication step tab is missing');
  await act(async () => { publicationTab.click(); });
  assert.ok(incubator.host.textContent.includes('SS-EDUQ2345'), 'team does not see its own ownership code');
  assert.ok(incubator.host.textContent.includes('Добавь код команды'), 'publication flow does not explain the ownership step');
  const read = [...incubator.host.querySelectorAll('button')].find(b => b.textContent.includes('Прочитано'));
  await act(async () => { read.click(); });
  assert.ok(calls.some(c => c.url.includes('/api/team/reminders/r1/read')), 'read receipt was not sent');
  return calls.length;
}
