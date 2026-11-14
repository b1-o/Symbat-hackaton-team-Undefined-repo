export const COUNTRIES = [
  { code: 'KZ', flag: '🇰🇿', name: 'Казахстан' },
  { code: 'UZ', flag: '🇺🇿', name: 'Узбекистан' },
  { code: 'KG', flag: '🇰🇬', name: 'Кыргызстан' },
  { code: 'AZ', flag: '🇦🇿', name: 'Азербайджан' },
  { code: 'GE', flag: '🇬🇪', name: 'Грузия' },
];
export const STEPS = [
  {
    index: 1,
    title: 'Идея и пользователь',
    short: 'Найти проблему',
    description: 'Выберите знакомую проблему и опишите, для кого решаете её.',
    prompt:
      'Какую конкретную проблему я заметил? Кто с ней сталкивается? Почему существующий способ неудобен?',
    example: 'Проблема → конкретный пользователь → ситуация → почему это важно',
    icon: 'lightbulb',
  },
  {
    index: 2,
    title: 'Проверка проблемы',
    short: 'Поговорить с людьми',
    description:
      'Проведите минимум три коротких интервью. Запишите вопросы и ответы без персональных данных.',
    prompt: 'Кого мы спросили? Что узнали? Какой вывод изменил нашу идею?',
    example: '3 обезличенных интервью → наблюдения → вывод → следующая проверка',
    icon: 'messages',
  },
  {
    index: 3,
    title: 'Решение и бизнес-модель',
    short: 'Собрать решение',
    description: 'Опишите минимальную версию продукта, отличие от альтернатив и того, кто платит.',
    prompt: 'Что делает MVP? Какую одну задачу решает? Кто пользователь и кто клиент? Какие расходы?',
    example: 'MVP → ценность → альтернативы → модель доходов → расходы',
    icon: 'blocks',
  },
  {
    index: 4,
    title: 'Питч и материалы',
    short: 'Подготовить питч',
    description: 'Соберите понятный питч: проблема, решение, доказательства и следующий шаг.',
    prompt: 'Как объяснить проект за 60 секунд? Какие факты подтверждены, а какие пока гипотезы?',
    example: 'Крючок → проблема → решение → доказательства → команда → запрос',
    icon: 'presentation',
  },
  {
    index: 5,
    title: 'Публикация в AI Startify',
    short: 'Показать миру',
    description:
      'Опубликуйте паспорт в AI Startify и отправьте ссылку. Зачёт — только после ручной проверки.',
    prompt:
      'Проверьте название, описание и отсутствие личных данных. Скопируйте ссылку на опубликованный паспорт.',
    example: 'Паспорт проекта → проверка организатором → витрина → рейтинг школы',
    icon: 'rocket',
  },
];
export const CATEGORIES = ['EdTech', 'ClimateTech', 'Social Impact', 'AI & Tools', 'Другое'];
export function cleanText(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
export function countryName(code) {
  return COUNTRIES.find((c) => c.code === code)?.name || code;
}
export function normalizePassportUrl(input) {
  if (typeof input !== 'string' || !input.trim())
    return { ok: false, error: 'Укажите ссылку на паспорт проекта.' };
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, error: 'Ссылка должна быть корректным URL.' };
  }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password)
    return { ok: false, error: 'Используйте HTTPS-ссылку без пароля и нестандартного порта.' };
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
    { label: 'Публикация подтверждена организатором', done: team.steps[4]?.completed },
  ];
  return { checks, percent: checks.filter((c) => c.done).length * 20 };
}
export function funnelModel({
  users = 96000,
  teamSize = 2,
  activation = 80,
  completion = 60,
  publication = 65,
  approval = 90,
  baseline = 567,
}) {
  // One team publishes one passport. Never count the same project once per member.
  if (!Number.isFinite(teamSize) || teamSize <= 0)
    throw new RangeError('teamSize must be a positive finite number');
  const teams = users / teamSize;
  const started = (teams * activation) / 100;
  const completed = (started * completion) / 100;
  const submitted = (completed * publication) / 100;
  const approved = (submitted * approval) / 100;
  return {
    teams: Math.round(teams),
    started: Math.round(started),
    completed: Math.round(completed),
    submitted: Math.round(submitted),
    approved: Math.round(approved),
    total: Math.round(approved + baseline),
    conversion: users ? (approved / users) * 100 : 0,
  };
}
// Reverse funnel against a fixed calendar deadline. The bottleneck is school onboarding
// throughput, not the funnel percentages: you cannot convert schools you never signed.
export function deadlineModel({
  now = new Date(),
  deadline = '2026-12-31',
  baseline = 567,
  target = 10000,
  teamSize = 2,
  activation = 80,
  completion = 60,
  publication = 65,
  approval = 90,
  sprintDays = 7,
  onboardingDays = 14,
  teamsPerSchool = 6,
  schoolsPerWeek = 10,
  schoolsPerCoordinator = 25,
  reviewsPerModeratorWeek = 150,
} = {}) {
  const end = new Date(`${deadline}T23:59:59Z`).getTime();
  const start = new Date(now).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(start))
    throw new RangeError('now and deadline must be valid dates');
  for (const [name, value] of Object.entries({
    teamSize,
    sprintDays,
    teamsPerSchool,
    schoolsPerCoordinator,
    reviewsPerModeratorWeek,
  })) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError(`${name} must be a positive finite number`);
  }
  if (approval <= 0 || approval > 100) throw new RangeError('approval must be in (0, 100]');
  const daysLeft = Math.max(0, Math.ceil((end - start) / 86400000));
  const weeksLeft = daysLeft / 7;
  const onboardingWeeks = Math.max(0, (daysLeft - onboardingDays) / 7);
  const waves = Math.max(0, Math.floor((daysLeft - onboardingDays) / sprintDays));
  const teamConversion = (activation / 100) * (completion / 100) * (publication / 100) * (approval / 100);
  const requiredApproved = Math.max(0, target - baseline);
  const requiredTeams = teamConversion > 0 ? Math.ceil(requiredApproved / teamConversion) : null;
  const requiredSchools = requiredTeams === null ? null : Math.ceil(requiredTeams / teamsPerSchool);
  const requiredReviews = Math.ceil(requiredApproved / (approval / 100));
  const capacitySchools = Math.floor(schoolsPerWeek * onboardingWeeks);
  const capacityTeams = capacitySchools * teamsPerSchool;
  const capacityApproved = Math.floor(capacityTeams * teamConversion);
  const weeksForReview = Math.max(weeksLeft, 1 / 7);
  const round = (value, digits = 1) => (value === null ? null : +value.toFixed(digits));
  const requiredSchoolsPerWeek =
    requiredSchools === null || onboardingWeeks <= 0 ? null : requiredSchools / onboardingWeeks;
  const gap = Math.max(0, requiredApproved - capacityApproved);
  const shareOfGoal = requiredApproved ? (capacityApproved / requiredApproved) * 100 : 100;
  // No full sprint fits before the deadline => nothing can be verified in time, whatever the funnel says.
  const verdict =
    waves < 1
      ? 'no_time'
      : capacityApproved >= requiredApproved
        ? 'reachable'
        : shareOfGoal >= 60
          ? 'at_risk'
          : 'unreachable';
  return {
    deadline,
    daysLeft,
    weeksLeft: round(weeksLeft),
    onboardingWeeks: round(onboardingWeeks),
    waves,
    teamConversion: round(teamConversion * 100, 2),
    required: {
      approved: requiredApproved,
      teams: requiredTeams,
      users: requiredTeams === null ? null : Math.ceil(requiredTeams * teamSize),
      schools: requiredSchools,
      schoolsPerWeek: round(requiredSchoolsPerWeek),
      reviews: requiredReviews,
      coordinators: requiredSchools === null ? null : Math.ceil(requiredSchools / schoolsPerCoordinator),
      moderators: Math.ceil(requiredReviews / (reviewsPerModeratorWeek * weeksForReview)),
    },
    capacity: {
      schools: capacitySchools,
      teams: capacityTeams,
      approved: capacityApproved,
      total: capacityApproved + baseline,
      shareOfGoal: round(shareOfGoal),
      reviews: Math.ceil(capacityApproved / (approval / 100)),
      coordinators: Math.ceil(capacitySchools / schoolsPerCoordinator),
      moderators: Math.ceil(
        Math.ceil(capacityApproved / (approval / 100)) / (reviewsPerModeratorWeek * weeksForReview),
      ),
    },
    gapApproved: gap,
    onboardingMultiple:
      requiredSchoolsPerWeek === null ? null : round(requiredSchoolsPerWeek / schoolsPerWeek),
    verdict,
  };
}
export function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}
export function hoursBetween(from, to = Date.now()) {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = typeof to === 'number' ? to : new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3600000;
}
// Why a coordinator should look at this team today. Ordered by how much a nudge is worth.
export function attentionReason(team, nowMs = Date.now()) {
  const steps = Number(team.stepsCompleted) || 0;
  const status = team.submissionStatus || null;
  if (status === 'approved') return null;
  if (status === 'returned')
    return { code: 'returned', label: 'Проект вернули на доработку', tone: 'red', priority: 1 };
  if (steps >= 4 && !status)
    return { code: 'ready', label: 'Готовы опубликовать паспорт', tone: 'purple', priority: 2 };
  if (status === 'pending')
    return { code: 'review', label: 'Ждёт проверки организатором', tone: 'amber', priority: 5 };
  const sinceCreated = hoursBetween(team.createdAt, nowMs);
  if (!team.startedAt && sinceCreated !== null && sinceCreated >= 24)
    return { code: 'not_started', label: 'Не начали работу больше суток', tone: 'red', priority: 3 };
  const idle = hoursBetween(team.lastActivityAt || team.startedAt || team.createdAt, nowMs);
  if (idle !== null && idle >= 48)
    return { code: 'idle', label: `Нет активности ${Math.floor(idle / 24)} дн.`, tone: 'amber', priority: 4 };
  return null;
}
export const REMINDER_PRESETS = [
  'Загляните в инкубатор: следующий этап ждёт всего одного маленького шага.',
  'На этапе 2 нужны три коротких интервью. Запишите выводы без личных данных.',
  'Ваши четыре этапа готовы. Опубликуйте паспорт в AI Startify и отправьте ссылку на проверку.',
  'Проект вернули на доработку: прочитайте комментарий организатора и отправьте снова.',
];
const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ә: 'a',
  ғ: 'g',
  қ: 'q',
  ң: 'n',
  ө: 'o',
  ұ: 'u',
  ү: 'u',
  һ: 'h',
  і: 'i',
};
export function challengeSlug(title) {
  const base = String(title || '')
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'sprint';
}
export function referralAttribution(teams) {
  const validIds = new Set(teams.map((t) => t.schoolId));
  return teams.filter(
    (t) => t.referredBySchoolId && t.referredBySchoolId !== t.schoolId && validIds.has(t.referredBySchoolId),
  ).length;
}
