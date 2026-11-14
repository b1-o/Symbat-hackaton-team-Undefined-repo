export const COUNTRIES = [
  { code: 'KZ', name: 'Казахстан' },
  { code: 'UZ', name: 'Узбекистан' },
  { code: 'KG', name: 'Кыргызстан' },
  { code: 'AZ', name: 'Азербайджан' },
  { code: 'GE', name: 'Грузия' }
];

export const STEPS = [
  {
    index: 1,
    title: 'Идея и пользователь',
    description: 'Выберите знакомую проблему и опишите, для кого решаете её.'
  },
  {
    index: 2,
    title: 'Проверка проблемы',
    description: 'Поговорите хотя бы с одним потенциальным пользователем и зафиксируйте вывод.'
  },
  {
    index: 3,
    title: 'Решение и бизнес-модель',
    description: 'Проработайте решение, рынок и модель ценности в AI Startify.'
  },
  {
    index: 4,
    title: 'Питч и материалы',
    description: 'Подготовьте описание проекта и материалы для публикации.'
  },
  {
    index: 5,
    title: 'Публикация в AI Startify',
    description: 'Опубликуйте проект и отправьте ссылку на паспорт организатору.'
  }
];

export const DEFAULT_REMINDER = 'Проверьте следующий шаг спринта. Если команда застряла, напишите учителю или организатору — поможем дойти до публикации.';

export function normalizePassportUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'Укажите ссылку на паспорт проекта.' };
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, error: 'Ссылка должна быть корректным URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Используйте HTTPS-ссылку на AI Startify.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'aistartify.com') {
    return { ok: false, error: 'Нужна ссылка на домен aistartify.com.' };
  }

  const match = parsed.pathname.match(/^\/startup\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    return { ok: false, error: 'Ожидается ссылка вида https://aistartify.com/startup/<id>.' };
  }

  return {
    ok: true,
    url: `https://aistartify.com/startup/${match[1]}`
  };
}

export function cleanText(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function countryName(code) {
  return COUNTRIES.find((country) => country.code === code)?.name || code;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function hoursBetween(from, to) {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
}

export function attentionReason(team, now = new Date()) {
  if (team.submission_status === 'approved' || team.submission_status === 'pending') return null;
  if (team.submission_status === 'returned') return 'Проект возвращён на доработку';
  if (!team.started_at) return 'Команда ещё не начала спринт';
  if ((team.steps_completed || 0) < 3) return 'Команда на раннем этапе';
  if (!team.submission_status && (team.steps_completed || 0) >= 3) return 'Проверьте готовность к публикации';
  const last = team.last_activity_at ? new Date(team.last_activity_at).getTime() : null;
  if (last && now.getTime() - last >= 24 * 3600000) return 'Нет активности больше 24 часов';
  return null;
}

export function challengeSlug(title) {
  const base = cleanText(title, 80)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'school-sprint';
}
