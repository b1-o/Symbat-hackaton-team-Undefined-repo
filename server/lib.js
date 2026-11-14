export const COUNTRIES = [
  { code: 'KZ', flag: '🇰🇿', name: 'Казахстан' },
  { code: 'UZ', flag: '🇺🇿', name: 'Узбекистан' },
  { code: 'KG', flag: '🇰🇬', name: 'Кыргызстан' },
  { code: 'AZ', flag: '🇦🇿', name: 'Азербайджан' },
  { code: 'GE', flag: '🇬🇪', name: 'Грузия' }
];
export const STEPS = [
  { index: 1, title: 'Идея и пользователь', short: 'Найти проблему', description: 'Выберите знакомую проблему и опишите, для кого решаете её.', prompt: 'Какую конкретную проблему я заметил? Кто с ней сталкивается? Почему существующий способ неудобен?', example: 'Проблема → конкретный пользователь → ситуация → почему это важно', icon: 'lightbulb' },
  { index: 2, title: 'Проверка проблемы', short: 'Поговорить с людьми', description: 'Проведите минимум три коротких интервью. Запишите вопросы и ответы без персональных данных.', prompt: 'Кого мы спросили? Что узнали? Какой вывод изменил нашу идею?', example: '3 обезличенных интервью → наблюдения → вывод → следующая проверка', icon: 'messages' },
  { index: 3, title: 'Решение и бизнес-модель', short: 'Собрать решение', description: 'Опишите минимальную версию продукта, отличие от альтернатив и того, кто платит.', prompt: 'Что делает MVP? Какую одну задачу решает? Кто пользователь и кто клиент? Какие расходы?', example: 'MVP → ценность → альтернативы → модель доходов → расходы', icon: 'blocks' },
  { index: 4, title: 'Питч и материалы', short: 'Подготовить питч', description: 'Соберите понятный питч: проблема, решение, доказательства и следующий шаг.', prompt: 'Как объяснить проект за 60 секунд? Какие факты подтверждены, а какие пока гипотезы?', example: 'Крючок → проблема → решение → доказательства → команда → запрос', icon: 'presentation' },
  { index: 5, title: 'Публикация в AI Startify', short: 'Показать миру', description: 'Опубликуйте паспорт в AI Startify и отправьте ссылку. Зачёт — только после ручной проверки.', prompt: 'Проверьте название, описание и отсутствие личных данных. Скопируйте ссылку на опубликованный паспорт.', example: 'Паспорт проекта → проверка организатором → витрина → рейтинг школы', icon: 'rocket' }
];
export const CATEGORIES = ['EdTech', 'ClimateTech', 'Social Impact', 'AI & Tools', 'Другое'];
export function cleanText(value, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function countryName(code) { return COUNTRIES.find(c => c.code === code)?.name || code; }
export function normalizePassportUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Укажите ссылку на паспорт проекта.' };
  let parsed;
  try { parsed = new URL(input.trim()); } catch { return { ok: false, error: 'Ссылка должна быть корректным URL.' }; }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return { ok: false, error: 'Используйте HTTPS-ссылку без пароля и нестандартного порта.' };
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'aistartify.com') return { ok: false, error: 'Нужна ссылка на домен aistartify.com.' };
  const match = parsed.pathname.match(/^\/startup\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return { ok: false, error: 'Ожидается ссылка вида https://aistartify.com/startup/<id>.' };
  return { ok: true, url: `https://aistartify.com/startup/${match[1]}` };
}
export function projectReadiness(team) {
  const checks = [
    { label: 'Определены проблема и пользователь', done: team.steps[0]?.completed },
    { label: 'Есть результаты интервью', done: team.steps[1]?.completed },
    { label: 'Описаны решение и бизнес-модель', done: team.steps[2]?.completed },
    { label: 'Подготовлен питч', done: team.steps[3]?.completed },
    { label: 'Публикация подтверждена организатором', done: team.steps[4]?.completed }
  ];
  return { checks, percent: checks.filter(c => c.done).length * 20 };
}
export function funnelModel({ users = 96000, teamSize = 2, activation = 80, completion = 60, publication = 65, approval = 90, baseline = 567 }) {
  // One team publishes one passport. Never count the same project once per member.
  if (!Number.isFinite(teamSize) || teamSize <= 0) throw new RangeError('teamSize must be a positive finite number');
  const teams = users / teamSize;
  const started = teams * activation / 100;
  const completed = started * completion / 100;
  const submitted = completed * publication / 100;
  const approved = submitted * approval / 100;
  return { teams: Math.round(teams), started: Math.round(started), completed: Math.round(completed), submitted: Math.round(submitted), approved: Math.round(approved), total: Math.round(approved + baseline), conversion: users ? approved / users * 100 : 0 };
}
export function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function referralAttribution(teams) {
  const validIds = new Set(teams.map(t => t.schoolId));
  return teams.filter(t => t.referredBySchoolId && t.referredBySchoolId !== t.schoolId && validIds.has(t.referredBySchoolId)).length;
}
