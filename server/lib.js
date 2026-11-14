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
