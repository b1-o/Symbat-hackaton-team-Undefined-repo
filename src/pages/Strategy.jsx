import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Globe2,
  Target,
  Users,
  Rocket,
  CheckCircle2,
  Flag,
  ShieldCheck,
  FlaskConical,
  CalendarDays,
  Wallet,
  TriangleAlert,
  Megaphone,
  School,
  Timer,
  Hourglass,
  Building2,
  UserCog,
} from 'lucide-react';
import { Badge, Button, Card, SectionHead } from '../components/UI';
import { downloadFile, number } from '../lib/api';
import { funnelModel, deadlineModel } from '../../server/lib.js';

const BUDGET = [
  ['Продукт, аналитика и QA', 18000],
  ['Локализация и доступность', 9000],
  ['Школьные координаторы и обучение', 24000],
  ['Модерация и наставники', 21000],
  ['Челленджи и нематериальные награды', 8000],
  ['Инфраструктура и LLM', 10000],
  ['Контент, PR и пилотные кампании', 12000],
  ['Резерв 15%', 15300],
];
const COUNTRIES = [
  ['🇰🇿', 'Казахстан', '28 800', 'KZ / RU', 'Опора на существующие образовательные связи'],
  ['🇺🇿', 'Узбекистан', '28 800', 'UZ / RU', 'Большая школьная аудитория, локальные клубы'],
  ['🇰🇬', 'Кыргызстан', '14 400', 'KY / RU', 'Пилот через школы и внеклассные программы'],
  ['🇦🇿', 'Азербайджан', '14 400', 'AZ / EN', 'Школы с предпринимательскими программами'],
  ['🇬🇪', 'Грузия', '9 600', 'KA / EN', 'Небольшие когорты, быстрые циклы обучения'],
];
export default function Strategy() {
  const [tab, setTab] = useState('model'),
    [users, setUsers] = useState(96000),
    [teamSize, setTeamSize] = useState(2),
    [activation, setActivation] = useState(80),
    [completion, setCompletion] = useState(60),
    [publication, setPublication] = useState(65),
    [approval, setApproval] = useState(90);
  const [schoolsPerWeek, setSchoolsPerWeek] = useState(10),
    [teamsPerSchool, setTeamsPerSchool] = useState(6),
    [onboardingDays, setOnboardingDays] = useState(14);
  const model = funnelModel({ users, teamSize, activation, completion, publication, approval });
  const dl = deadlineModel({
    teamSize,
    activation,
    completion,
    publication,
    approval,
    schoolsPerWeek,
    teamsPerSchool,
    onboardingDays,
  });
  const verdicts = {
    reachable: [
      'green',
      'Арифметика сходится',
      'Но только при выполнении всех условий ниже — это план национальной сети, не школьного клуба.',
    ],
    at_risk: [
      'amber',
      'На грани',
      'Канал закрывает большую часть цели, но любой срыв недели ломает результат.',
    ],
    unreachable: [
      'red',
      'Недостижимо в этот срок',
      'Ограничение — скорость подключения школ, а не проценты воронки.',
    ],
    no_time: [
      'red',
      'Не осталось полных волн',
      'До дедлайна не успевает завершиться и пройти проверку ни один спринт.',
    ],
  };
  const [verdictTone, verdictTitle, verdictText] = verdicts[dl.verdict];
  const exportDeadline = () =>
    downloadFile(
      'startify-deadline-2026.json',
      JSON.stringify(
        {
          disclaimer: 'Scenario, not a promise. Capacity is limited by school onboarding throughput.',
          generatedAt: new Date().toISOString(),
          assumptions: {
            deadline: dl.deadline,
            teamSize,
            activation,
            completion,
            publication,
            approval,
            schoolsPerWeek,
            teamsPerSchool,
            onboardingDays,
            sprintDays: 7,
            schoolsPerCoordinator: 25,
            reviewsPerModeratorWeek: 150,
          },
          result: dl,
          commitmentByDec31: { schools: 20, teams: 120, approvedMinimum: 25 },
        },
        null,
        2,
      ),
      'application/json',
    );
  const totalBudget = BUDGET.reduce((s, b) => s + b[1], 0);
  const exportModel = () =>
    downloadFile(
      'startify-growth-model.json',
      JSON.stringify(
        {
          disclaimer:
            'Scenario, not observed results. Baseline from hackathon brief, not audited platform analytics.',
          horizon: '12 months after pilot approval; strategy delivered in 2026',
          assumptions: {
            existingUsers: 4000,
            baselineProjects: 567,
            newUsers: users,
            averageTeamSize: teamSize,
            activationOfTeams: activation,
            completionOfActivatedTeams: completion,
            publicationOfCompletedTeams: publication,
            approvalOfSubmitted: approval,
          },
          result: model,
          budgetUSD: Object.fromEntries(BUDGET),
          activationCostPerIncrementalApproved: model.approved ? totalBudget / model.approved : null,
          acquisitionEnvelopeUSD: users,
          acquisitionAssumptionUSDPerUser: 1,
          combinedScenarioCostUSD: totalBudget + users,
        },
        null,
        2,
      ),
      'application/json',
    );
  return (
    <>
      <SectionHead
        eyebrow="НАПРАВЛЕНИЕ 02 · STARTUP CREATION & ACTIVATION"
        title="Не больше регистраций. Больше состоявшихся стартапов."
        text="Исследование AI Startify, проверяемая воронка и международный план. Цифры ниже — сценарные допущения, не обещания."
      >
        <Button variant="ghost" onClick={exportModel}>
          <Download size={16} />
          Скачать модель
        </Button>
      </SectionHead>
      <div className="strategy-north">
        <div>
          <span className="eyebrow">НАШ NORTH STAR</span>
          <h2>
            10 000 <span>подтверждённых публикаций</span>
          </h2>
        </div>
        <ArrowRight size={26} />
        <div>
          <span className="eyebrow">ЗАВИСИМОСТЬ ОТ НАПРАВЛЕНИЯ 01</span>
          <h2>
            100 000 <span>школьников на платформе</span>
          </h2>
        </div>
      </div>
      <div className="tabs strategy-tabs" role="tablist">
        {[
          ['model', 'Воронка и KPI', Target],
          ['research', 'Исследование', Globe2],
          ['plan', 'План и бюджет', CalendarDays],
          ['campaign', 'Кампания', Megaphone],
          ['deadline', 'Дедлайн 31.12', Timer],
        ].map(([key, label, Icon]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            key={key}
            onClick={() => setTab(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === 'model' && (
        <>
          <div className="strategy-grid">
            <Card className="calculator">
              <div className="card-heading">
                <h2>Что должно случиться после регистрации?</h2>
                <Badge tone="purple">Интерактивная модель</Badge>
              </div>
              <p className="muted">
                96 000 новых школьников + 4 000 существующих = цель 100 000. Один проект публикует одна
                команда, не каждый участник. Проценты применяются последовательно к командам; средний размер
                команды — проверяемое допущение.
              </p>
              {[
                [users, setUsers, 'Новые школьники за 12 месяцев', 10000, 200000, 1000, ''],
                [teamSize, setTeamSize, 'Средний размер команды (участников)', 1, 4, 0.5, ''],
                [activation, setActivation, 'Команды начали работу в инкубаторе', 20, 95, 1, '%'],
                [completion, setCompletion, 'Завершили подготовку из начавших команд', 10, 90, 1, '%'],
                [publication, setPublication, 'Опубликовали паспорт из завершивших команд', 10, 95, 1, '%'],
                [approval, setApproval, 'Прошли ручную проверку из отправленных', 50, 100, 1, '%'],
              ].map(([value, setter, label, min, max, step, suffix]) => (
                <label className="slider-field" key={label}>
                  <span>
                    {label}
                    <strong>
                      {number(value)}
                      {suffix}
                    </strong>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => setter(+e.target.value)}
                  />
                </label>
              ))}
              <button
                className="text-link"
                onClick={() => {
                  setUsers(96000);
                  setTeamSize(2);
                  setActivation(80);
                  setCompletion(60);
                  setPublication(65);
                  setApproval(90);
                }}
              >
                Базовый сценарий
              </button>
            </Card>
            <Card className="projection">
              <Badge tone="lime">РЕЗУЛЬТАТ СЦЕНАРИЯ</Badge>
              <h2>{number(model.total)}</h2>
              <p>публикаций с учётом стартовых 567</p>
              <div className={`goal-status ${model.total >= 10000 ? 'met' : ''}`}>
                <Target size={18} />
                {model.total >= 10000
                  ? `Цель достигнута в модели: +${number(model.total - 10000)} запас`
                  : `До цели не хватает ${number(10000 - model.total)} публикаций`}
              </div>
              <div className="projection-funnel">
                {[
                  ['Новые школьники', users],
                  ['Команды (оценка)', model.teams],
                  ['Начали', model.started],
                  ['Завершили', model.completed],
                  ['Опубликовали', model.submitted],
                  ['Подтверждено проектов', model.approved],
                ].map(([label, value], i) => (
                  <div key={label}>
                    <span>{label}</span>
                    <div>
                      <i style={{ width: `${Math.max(2, (value / users) * 100)}%`, opacity: 1 - i * 0.12 }} />
                    </div>
                    <strong>{number(value)}</strong>
                  </div>
                ))}
              </div>
              <dl>
                <dt>Новых проектов на 100 новых участников</dt>
                <dd>{model.conversion.toFixed(1)}%</dd>
                <dt>Стоимость активации на зачёт</dt>
                <dd>${model.approved ? (totalBudget / model.approved).toFixed(2) : '—'}</dd>
              </dl>
              <small>
                Базовый сценарий: пары, 80% старт → 60% подготовка → 65% публикация → 90% зачёт. Это 14,04
                проекта на 100 участников, близко к ориентиру Digital College ≈14%, но не доказательство. При
                среднем размере 3 человека та же воронка не достигает цели. Исторические 567 / 4 000 —
                отношение счётчиков, не когортная конверсия.
              </small>
            </Card>
          </div>
          <div className="scenario-grid">
            {[
              ['Осторожный', 65, 45, 55, 85],
              ['Базовый', 80, 60, 65, 90],
              ['Ускоренный', 85, 70, 75, 95],
            ].map(([name, a, c, p, q]) => {
              const r = funnelModel({
                users,
                teamSize,
                activation: a,
                completion: c,
                publication: p,
                approval: q,
              });
              return (
                <Card key={name}>
                  <span className="eyebrow">{name}</span>
                  <h3>
                    {number(r.total)} <small>публикаций</small>
                  </h3>
                  <p>
                    {a}% старт → {c}% подготовка → {p}% публикация → {q}% проверка
                  </p>
                  <button
                    className="text-link"
                    onClick={() => {
                      setActivation(a);
                      setCompletion(c);
                      setPublication(p);
                      setApproval(q);
                    }}
                  >
                    Применить допущения <ArrowRight size={14} />
                  </button>
                </Card>
              );
            })}
          </div>
          <Card>
            <h2>KPI, которые меняют поведение</h2>
            <div className="kpi-grid">
              {[
                ['Time to first value', '< 10 минут', 'Первая сохранённая заметка команды'],
                ['D7 retention команд', '≥ 25%', 'Возврат к работе на 6–8-й день; ученики — отдельно'],
                ['Подготовка → паспорт', '≥ 60%', 'Одна когорта, единое окно'],
                ['Проверка проекта', '< 48 часов', 'Медиана и p90 отдельно'],
                ['Дубли и фрод', '< 2%', 'Отклонённые / проверенные'],
                [
                  'Стоимость активации на зачёт',
                  '≤ $9,00',
                  'Бюджет активации / новые зачёты; привлечение отдельно',
                ],
              ].map(([a, b, c]) => (
                <div key={a}>
                  <small>{a}</small>
                  <strong>{b}</strong>
                  <p>{c}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      {tab === 'research' && (
        <>
          <Card>
            <div className="card-heading">
              <h2>Что уже есть у AI Startify</h2>
              <Badge>Проверено 14.11.2026</Badge>
            </div>
            <p>
              Публичный сайт описывает AI-инкубатор с 10 этапами, независимую проверку, витрину, паспорт
              проекта и сертификат. Есть предложения для школ, колледжей, университетов и корпоративных
              хакатонов. Наша лига — слой активации поверх этого пути, а не замена продукта.
            </p>
            <div className="notice warning">
              Счётчики публичной страницы динамические: при проверке 14.11.2026 видели 3 896+–3 903+
              участников, 576+ проектов, 106+ инвесторов. Бриф даёт 4 000+ и 567+. Это разные
              снимки/определения; для модели используем условия брифа. Ни один из этих показателей не
              подтверждает число уникальных школьников.{' '}
              <a href="https://aistartify.com/" target="_blank" rel="noreferrer">
                Источник ↗
              </a>
            </div>
            <div className="swot">
              {[
                [
                  'S',
                  'Сильные стороны',
                  'Целостный путь от идеи до паспорта; витрина и внешнее признание; готовая инфраструктура для образовательных организаций.',
                ],
                [
                  'W',
                  'Слабые места / гипотезы',
                  'Нет публичной когортной воронки и данных об удержании школьников. Необходимы замер выхода на первую ценность, локализация и понятные правила для несовершеннолетних.',
                ],
                [
                  'O',
                  'Возможности',
                  'Школьные клубы как повторяемый канал; международные спринты; партнёрские кейсы; SmallThinker для локального инференса и контроля затрат.',
                ],
                [
                  'T',
                  'Барьеры',
                  'Языки и доступ к устройствам; согласие родителей; нехватка модераторов; сезонность школ; накрутки; отсутствие официального API и юридические ограничения разных стран.',
                ],
              ].map(([letter, title, text]) => (
                <div key={letter}>
                  <span>{letter}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2>Аудитория и первый международный контур</h2>
            <p className="muted">
              Ядро: школьники 13–18 лет, интересы — технологии, экология и школьная жизнь. Посредники: учителя
              и координаторы. Условия — не размер населения — определяют порядок пилота.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Страна</th>
                    <th>Цель новых участников*</th>
                    <th>Языки</th>
                    <th>Гипотеза входа</th>
                  </tr>
                </thead>
                <tbody>
                  {COUNTRIES.map(([flag, name, target, langs, reason]) => (
                    <tr key={name}>
                      <td>
                        {flag} {name}
                      </td>
                      <td>{target}</td>
                      <td>{langs}</td>
                      <td>{reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small className="muted">
              *Распределение 96 000 новых участников пропорционально приоритетам пилота; вместе с 4 000
              существующими — цель 100 000. Это плановые квоты, не прогноз спроса. Все 4 000 существующих
              должны подходить под определение школьника; это требует проверки. KY и KA требуют носителей
              языка до запуска.
            </small>
          </Card>
          <div className="two-col">
            <Card>
              <h3>Коммуникации и конкурентное отличие</h3>
              <p>
                Публичный YouTube-канал обещает startup-проект за день с AI. Подтверждённые official
                Instagram/Telegram в ходе проверки не найдены — их аудиторию не выдумываем.
              </p>
              <p>
                В отличие от универсального чатбота, Sprint связывает этап с рабочим артефактом, командой
                школы, дедлайном и проверенной публикацией. В отличие от разового хакатона — оставляет клуб и
                повторный цикл.
              </p>
              <a
                className="text-link"
                href="https://www.youtube.com/channel/UCovST-Jqx2xna4p39HRdfSw"
                target="_blank"
                rel="noreferrer"
              >
                YouTube AI Startify <ArrowUpRight size={14} />
              </a>
            </Card>
            <Card>
              <h3>Партнёры: подтверждённое ≠ желаемое</h3>
              <p>
                Публичные материалы описывают программы AI-Sana и связи университетов с Astana Hub; есть
                примеры внедрения AI Startify в Digital College и МТГУ. Это ориентиры для образовательного
                канала, не подтверждение партнёрства с нашей командой.
              </p>
              <p>
                Потенциальные следующие партнёры: школьные сети, TUMO, университеты-кураторы, местные EdTech и
                корпоративные фонды. Нужны письма о намерениях, пилотные соглашения и проверка условий работы
                с детьми.
              </p>
              <a
                className="text-link"
                href="https://mtgu.edu.kz/ru/novost/start-aii-inkubacii-dlya-studentov-na-platforme-ai-startify"
                target="_blank"
                rel="noreferrer"
              >
                Пример образовательного внедрения <ArrowUpRight size={14} />
              </a>
            </Card>
          </div>
        </>
      )}
      {tab === 'plan' && (
        <>
          <div className="strategy-grid">
            <Card>
              <div className="card-heading">
                <h2>Бюджет программы активации</h2>
                <Wallet size={21} />
              </div>
              <p className="muted">
                12 месяцев после пилота, USD. Привлечение 96 000 участников — обязательная зависимость от
                направления 01; его медиабюджет сюда не включён.
              </p>
              {BUDGET.map(([label, cost]) => (
                <div className="budget-row" key={label}>
                  <span>{label}</span>
                  <strong>${number(cost)}</strong>
                </div>
              ))}
              <div className="budget-row total">
                <span>Итого</span>
                <strong>${number(totalBudget)}</strong>
              </div>
              <p className="small muted">
                Резерв: 15% от $102 000 прямых расходов. Бюджетный потолок, не коммерческие предложения
                поставщиков.
              </p>
            </Card>
            <Card>
              <h2>Экономическое обоснование</h2>
              <div className=" economics">
                <strong>${(totalBudget / Math.max(1, model.approved)).toFixed(2)}</strong>
                <p>
                  стоимость активации на новый подтверждённый проект; привлечение участников считается
                  отдельно
                </p>
              </div>
              <p>
                Считаем все расходы активации, а не только рекламу. Возврат ценности — портфолио школьника,
                проекты для партнёров и повторный цикл клубов; доход платформы не выдуман.
              </p>
              <h3>Условия масштабирования</h3>
              <ul className="plain-list">
                <li>20 школ → 100 школ → 500 школ только после прохождения порогов качества.</li>
                <li>Один координатор ведёт до 25 активных школ; модератор — до 150 проверок в неделю.</li>
                <li>
                  Стоимость LLM контролируется лимитами и измеряется на пилоте, а не принимается равной нулю.
                </li>
                <li>
                  При cost / approved выше $10 два цикла подряд — остановка расширения и разбор воронки.
                </li>
              </ul>
            </Card>
          </div>
          <Card>
            <h2>Roadmap: стратегия в 2026, масштабирование после проверки</h2>
            <div className="notice warning">
              До 31.12.2026 остаётся около семи недель. Обещать 100 000 школьников за этот срок без
              подтверждённых каналов нельзя. Ниже — поставка стратегии и пилот в 2026, затем 12 месяцев
              управляемого роста.
            </div>
            <div className="roadmap">
              {[
                [
                  '14–30 ноября 2026',
                  'Замер и безопасный пилот',
                  'Согласовать метрики, согласие и ручную проверку. 5 школ, 30 команд. Gate: первая ценность < 10 мин.',
                ],
                [
                  'Декабрь 2026',
                  'Спринт и защита стратегии',
                  '20 школ / 120 команд / цель ≥ 25 подтверждений. Проверка KZ/RU и UZ; решение о расширении по факту.',
                ],
                [
                  'Месяцы 1–3',
                  'Повторяемая когорта',
                  '100 школ, 5 000 новых участников, 500 подтверждённых публикаций. D7 ≥ 25%, модерация < 48 ч.',
                ],
                [
                  'Месяцы 4–6',
                  'Международный контур',
                  '250 школ, 30 000 участников суммарно, 3 000 подтверждённых публикаций. Локальные фасилитаторы.',
                ],
                [
                  'Месяцы 7–12',
                  'Масштаб через клубы',
                  '500 школ, 96 000 новых участников, ≥ 9 433 новых зачётов. Цель платформы ≥ 10 000.',
                ],
              ].map(([date, title, text], i) => (
                <div key={date}>
                  <span>{i + 1}</span>
                  <small>{date}</small>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2>Риски → конкретная защита</h2>
            <div className="risk-grid">
              {[
                [
                  'Качество ради количества',
                  'Зачёт только после публикации и чек-листа; один паспорт — одна команда; выборочный аудит.',
                ],
                [
                  'Данные несовершеннолетних',
                  'Минимум полей, согласия, возрастной порог, удаление данных, локальный инференс до правового запуска.',
                ],
                [
                  'Галлюцинации SmallThinker',
                  'JSON-валидация, метка AI, явное применение черновика, запрет выдуманных интервью и ручная модерация.',
                ],
                [
                  'Нехватка школ / сезонность',
                  'Воронка партнёрских соглашений, резервные страны, каникулярные клубы; не считать приглашения регистрациями.',
                ],
                [
                  'Перегрузка модерации',
                  'SLA, очередь по времени, лимит когорт, бюджет на резервных проверяющих.',
                ],
                [
                  'Нет официального API',
                  'Только подтверждённые ссылки и ручной зачёт; не обещать несуществующую синхронизацию.',
                ],
              ].map(([title, text]) => (
                <div key={title}>
                  <TriangleAlert size={18} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      {tab === 'campaign' && (
        <>
          <div className="campaign-hero">
            <Badge tone="lime">ГОТОВА К ПИЛОТУ МЕХАНИКА</Badge>
            <h2>
              «Проблема моей школы»
              <br />
              Вызов начинается в понедельник.
            </h2>
            <p>
              Ученик замечает проблему → собирает команду 1–4 участников (для пилота рекомендуем пары) →
              получает 5 понятных заданий → публикует проект при готовности → бросает вызов другой школе.
            </p>
            <Button
              variant="lime"
              onClick={() =>
                downloadFile(
                  'school-sprint-kit.md',
                  '# Startify Sprint — комплект учителя\n\n## Подготовка\nСогласия, устройства, код школы, 5 занятий по 30 минут.\n\n## День 1\nПроблема и пользователь. Сохранить первую заметку.\n## День 2\nТри обезличенных интервью. Не выдавать гипотезы за факты.\n## День 3\nMVP и модель ценности в AI Startify.\n## День 4\nПитч 60 секунд и обратная связь другой команды.\n## День 5\nПубликация при готовности, ссылка организатору.\n## День 6\nИсправления по результатам проверки.\n## День 7\nДемо-день, рефлексия, вызов другой школе.\n\n## Зачёт\nДоступный уникальный паспорт, полнота, безопасность. Не число регистраций.\n\n## Награды\nОбратная связь наставника, портфолио, признание школы. Без денежных ставок.\n\n## Измерение\nПриглашение → команда → первая заметка → интервью → публикация → зачёт; D7 retention.\n\nНе передавать персональные данные детей. Использовать nickname.\n',
                )
              }
            >
              Скачать комплект учителя <Download size={16} />
            </Button>
          </div>
          <div className="campaign-grid">
            {[
              [
                'Пн·Вт',
                'Увидеть и проверить',
                'Проблема + пользователь. Три коротких интервью без персональных данных. Артефакт: первые заметки.',
              ],
              [
                'Ср·Чт',
                'Собрать и рассказать',
                'Одно ключевое действие продукта, модель ценности, питч. Взаимная обратная связь двух школ.',
              ],
              [
                'Пт·Сб',
                'Опубликовать',
                'Паспорт в AI Startify, отправка ссылки, исправления. Слабая идея не штрафуется за незавершённость.',
              ],
              [
                'Вс',
                'Признать результат',
                'Онлайн Demo Day, портфолио и благодарность наставникам. Школа получает зачёт только за проверенные проекты.',
              ],
            ].map(([day, title, text]) => (
              <Card key={day}>
                <Badge tone="purple">{day}</Badge>
                <h3>{title}</h3>
                <p>{text}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h2>Вирусность без накруток</h2>
            <div className="viral-loop">
              <span>
                <School size={20} />
                Школа A
              </span>
              <ArrowRight />
              <span>Ссылка-вызов</span>
              <ArrowRight />
              <span>
                <Users size={20} />
                Команда школы B
              </span>
              <ArrowRight />
              <span>
                <Rocket size={20} />
                Подтверждённый проект
              </span>
            </div>
            <p>
              Ссылка сохраняет школу-приглашающую. Считаем созданные команды и последующие зачёты, а не клики
              или копирования. Награждаем полезную обратную связь и завершённую работу. Публичные списки детей
              не создаём.
            </p>
            <div className="notice">
              <FlaskConical size={19} />
              A/B-пилот: обычное приглашение vs вызов школы. Основная метрика — подтверждённая публикация на
              приглашённую школу; guardrail — жалобы и нагрузка модератора. Решение после минимум 20 школ и
              двух циклов, не по одному красивому проценту.
            </div>
          </Card>
        </>
      )}
      <div className="sources">
        <strong>Источники исследования</strong>
        <a href="https://aistartify.com/" target="_blank" rel="noreferrer">
          AI Startify · сайт и витрина ↗
        </a>
        <a
          href="https://er10.kz/read/it-novosti/digital-college-zapuskaet-pervyj-v-kazahstane-ai-inkubator-rabotajushhij-24-7/"
          target="_blank"
          rel="noreferrer"
        >
          Digital College · пример внедрения ↗
        </a>
        <a
          href="https://qazinform.com/news/from-campus-to-economy-kazakh-universities-turn-ai-into-working-products-a74459"
          target="_blank"
          rel="noreferrer"
        >
          AI-Sana / Astana Hub ↗
        </a>
        <a href="https://github.com/SJTU-IPADS/SmallThinker" target="_blank" rel="noreferrer">
          SmallThinker · модель ↗
        </a>
        <p>
          Полные материалы:{' '}
          <a href="/docs/RESEARCH.md" target="_blank" rel="noreferrer">
            исследование ↗
          </a>{' '}
          ·{' '}
          <a href="/docs/GROWTH_STRATEGY.md" target="_blank" rel="noreferrer">
            стратегия и модель ↗
          </a>{' '}
          ·{' '}
          <a href="/docs/DEADLINE_2026.md" target="_blank" rel="noreferrer">
            расчёт дедлайна ↗
          </a>
        </p>
      </div>
      {tab === 'deadline' && (
        <>
          <div className="deadline-hero">
            <div>
              <span className="eyebrow">ВОПРОС, КОТОРЫЙ ЗАДАСТ ЖЮРИ</span>
              <h2>
                А если цель строго
                <br />
                до 31 декабря 2026?
              </h2>
              <p>
                Считаем от календаря назад, а не от желаемого числа. Ограничение — сколько школ мы физически
                подключаем за неделю.
              </p>
            </div>
            <div className="deadline-clock">
              <Timer size={26} />
              <strong>{dl.daysLeft}</strong>
              <span>дней до дедлайна</span>
              <div className="deadline-waves">
                {Array.from({ length: Math.max(dl.waves, 1) }).map((_, i) => (
                  <i key={i} className={dl.waves ? 'filled' : ''} />
                ))}
              </div>
              <small>{dl.waves} полных спринта успевают завершиться и пройти проверку</small>
            </div>
          </div>
          <div className={`notice ${dl.verdict === 'reachable' ? '' : 'warning'} deadline-verdict`}>
            <TriangleAlert size={20} />
            <div>
              <strong>{verdictTitle}</strong>
              <p>{verdictText}</p>
            </div>
            <Badge tone={verdictTone}>{dl.capacity.shareOfGoal}% цели</Badge>
          </div>
          <div className="strategy-grid">
            <Card className="calculator">
              <div className="card-heading">
                <h2>Что мы контролируем</h2>
                <Badge tone="purple">Ёмкость канала</Badge>
              </div>
              <p className="muted">
                Проценты воронки берутся с вкладки «Воронка и KPI». Здесь меняем то, что упирается в людей и
                соглашения.
              </p>
              {[
                [schoolsPerWeek, setSchoolsPerWeek, 'Школ подключаем в неделю', 1, 1500, 1, ''],
                [teamsPerSchool, setTeamsPerSchool, 'Команд от одной школы', 1, 40, 1, ''],
                [teamSize, setTeamSize, 'Средний размер команды', 1, 4, 0.5, ''],
                [onboardingDays, setOnboardingDays, 'Дней на соглашения и обучение', 0, 40, 1, ''],
              ].map(([value, setter, label, min, max, step, suffix]) => (
                <label className="slider-field" key={label}>
                  <span>
                    {label}
                    <strong>
                      {number(value)}
                      {suffix}
                    </strong>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => setter(+e.target.value)}
                  />
                </label>
              ))}
              <div className="deadline-presets">
                {[
                  ['Органический пилот', 10, 6],
                  ['Партнёрская сеть', 150, 12],
                  ['Национальный роллаут', 1200, 12],
                ].map(([name, spw, tps]) => (
                  <button
                    key={name}
                    className="text-link"
                    onClick={() => {
                      setSchoolsPerWeek(spw);
                      setTeamsPerSchool(tps);
                      setOnboardingDays(14);
                    }}
                  >
                    {name} <ArrowRight size={13} />
                  </button>
                ))}
              </div>
              <Button variant="ghost" onClick={exportDeadline}>
                <Download size={16} />
                Скачать расчёт
              </Button>
            </Card>
            <Card className="projection">
              <Badge tone={verdictTone}>РЕЗУЛЬТАТ ДО 31.12</Badge>
              <h2>{number(dl.capacity.total)}</h2>
              <p>публикаций успеем подтвердить с учётом стартовых 567</p>
              <div className={`goal-status ${dl.gapApproved === 0 ? 'met' : ''}`}>
                <Target size={18} />
                {dl.gapApproved === 0
                  ? 'Цель закрыта в этом сценарии'
                  : `Не хватает ${number(dl.gapApproved)} подтверждённых проектов`}
              </div>
              <div className="deadline-compare">
                <div>
                  <span className="eyebrow">ТРЕБУЕТ ЦЕЛЬ</span>
                  <dl>
                    <dt>Команд</dt>
                    <dd>{number(dl.required.teams)}</dd>
                    <dt>Школ</dt>
                    <dd>{number(dl.required.schools)}</dd>
                    <dt>Школ в неделю</dt>
                    <dd>{number(dl.required.schoolsPerWeek)}</dd>
                    <dt>Проверок</dt>
                    <dd>{number(dl.required.reviews)}</dd>
                    <dt>Координаторов</dt>
                    <dd>{number(dl.required.coordinators)}</dd>
                    <dt>Модераторов</dt>
                    <dd>{number(dl.required.moderators)}</dd>
                  </dl>
                </div>
                <div>
                  <span className="eyebrow">ВЫДЕРЖИТ КАНАЛ</span>
                  <dl>
                    <dt>Команд</dt>
                    <dd>{number(dl.capacity.teams)}</dd>
                    <dt>Школ</dt>
                    <dd>{number(dl.capacity.schools)}</dd>
                    <dt>Школ в неделю</dt>
                    <dd>{number(schoolsPerWeek)}</dd>
                    <dt>Проверок</dt>
                    <dd>{number(dl.capacity.reviews)}</dd>
                    <dt>Координаторов</dt>
                    <dd>{number(dl.capacity.coordinators)}</dd>
                    <dt>Модераторов</dt>
                    <dd>{number(dl.capacity.moderators)}</dd>
                  </dl>
                </div>
              </div>
              {dl.onboardingMultiple > 1 && (
                <small>
                  Нужно подключать школы в <strong>{dl.onboardingMultiple}×</strong> быстрее, чем в этом
                  сценарии. Размер команды на число проектов не влияет: один паспорт — одна команда.
                </small>
              )}
            </Card>
          </div>
          <Card>
            <div className="card-heading">
              <h2>Что должно быть правдой, чтобы успеть</h2>
              <Badge tone="amber">Все пункты одновременно</Badge>
            </div>
            <div className="deadline-conditions">
              {[
                [
                  Building2,
                  'Национальный партнёр до 21 ноября',
                  'Соглашение с министерством, сетью хабов или крупной EdTech-сетью: рассылка сразу тысячам школ, а не согласование каждой.',
                ],
                [
                  School,
                  `${number(dl.required.schoolsPerWeek)} школ в неделю четыре недели подряд`,
                  'Это операционный конвейер подключения, а не маркетинговая кампания.',
                ],
                [
                  Users,
                  `${teamsPerSchool}+ команд от школы`,
                  'Участвуют классы, а не один кружок. При 6 командах на школу нужно вдвое больше школ.',
                ],
                [
                  UserCog,
                  `${number(dl.required.coordinators)} координаторов и ${number(dl.required.moderators)} модераторов`,
                  'Обучены до первой волны. Один координатор ведёт 25 школ, модератор — 150 проверок в неделю.',
                ],
                [
                  Hourglass,
                  'Проверка укладывается в 48 часов',
                  'Иначе проект опубликован в декабре, а зачёт получит уже в январе.',
                ],
                [
                  Globe2,
                  'Direction 01 приводит участников',
                  'Наша воронка начинается с уже пришедших команд, а не создаёт трафик.',
                ],
              ].map(([Icon, title, text]) => (
                <div key={title}>
                  <span className="icon-tile purple">
                    <Icon size={18} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="notice warning">
              Если хотя бы один пункт не выполняется, обещание «10 000 до конца года» нельзя защитить. Мы
              показываем границу как результат исследования.
            </div>
          </Card>
          <div className="scenario-grid">
            <Card className="commitment-card">
              <span className="eyebrow">НАШЕ ОБЯЗАТЕЛЬСТВО ДО 31.12</span>
              <h3>20 школ · 120 команд · ≥25 зачётов</h3>
              <p>
                Нижняя граница, за которую команда отвечает без внешних условий. Совпадает с декабрьским
                этапом roadmap.
              </p>
              <ul className="plain-list">
                <li>Time to first value &lt; 10 минут</li>
                <li>Проверка проекта &lt; 48 часов</li>
                <li>Одна полная измеренная когорта</li>
              </ul>
              <small>Ценность декабря — не 25 проектов, а замена сценарных процентов фактами.</small>
            </Card>
            <Card>
              <span className="eyebrow">ВАРИАНТ A</span>
              <h3>Горизонт — 12 месяцев</h3>
              <p>
                Текущая стратегия корректна. Декабрь — gate с измеренной когортой, дальше управляемое
                масштабирование до 10 000.
              </p>
              <button className="text-link" onClick={() => setTab('plan')}>
                Посмотреть roadmap <ArrowRight size={14} />
              </button>
            </Card>
            <Card>
              <span className="eyebrow">ВАРИАНТ B</span>
              <h3>Цель строго до 31.12</h3>
              <p>
                Тогда нужен подтверждённый национальный партнёр и операционный бюджет из списка условий.
                Просим организаторов подтвердить это явно.
              </p>
              <a className="text-link" href="/docs/DEADLINE_2026.md" target="_blank" rel="noreferrer">
                Полный расчёт и stop-rules <ArrowUpRight size={14} />
              </a>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
