import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Rocket,
  Users,
  School,
  Globe2,
  Sparkles,
  Clock3,
  Trophy,
  Flame,
  Check,
  Lightbulb,
  MessagesSquare,
  Blocks,
  Presentation,
  Compass,
} from 'lucide-react';
import { Badge, Button, Card, Progress } from '../components/UI';
import { number, formatDate } from '../lib/api';

export function ProjectCard({ project, navigate }) {
  const tones = { ClimateTech: 'green', EdTech: 'purple', 'Social Impact': 'orange', 'AI & Tools': 'blue' };
  const Icon =
    { ClimateTech: Globe2, EdTech: Lightbulb, 'Social Impact': Users, 'AI & Tools': Sparkles }[
      project.category
    ] || Rocket;
  return (
    <button
      className="project-card"
      onClick={() => navigate(`/showcase?q=${encodeURIComponent(project.title)}`)}
    >
      <div className={`project-art ${tones[project.category] || 'green'}`}>
        <div className="art-orbit" />
        <Icon size={43} strokeWidth={1.4} />
        <span className="art-dot one" />
        <span className="art-dot two" />
        <Badge>{project.category}</Badge>
        {project.is_demo && <span className="demo-tag">Демо</span>}
      </div>
      <div className="project-body">
        <h3>
          {project.title}
          <ArrowUpRight size={17} />
        </h3>
        <p>{project.description}</p>
        <div className="project-meta">
          <span className="tiny-avatar">{project.team_name.slice(0, 2)}</span>
          <span>
            {project.team_name}
            <small>{project.countryName}</small>
          </span>
          <span className="verified-dot" title="Подтверждён организатором">
            <Check size={12} />
          </span>
        </div>
      </div>
    </button>
  );
}
export default function Dashboard({ data, me, navigate }) {
  const team = me.role === 'team' ? me.team : null;
  const completed = team?.steps.filter((s) => s.completed).length || 0;
  const days = Math.max(0, Math.ceil((new Date(data.challenge.ends_at) - Date.now()) / 86400000));
  const icons = [Lightbulb, MessagesSquare, Blocks, Presentation, Rocket];
  return (
    <>
      <div className="welcome-line">
        <div>
          <span className="eyebrow">МАЛЕНЬКИЕ ШАГИ. БОЛЬШИЕ СТАРТАПЫ.</span>
          <h1>
            {team ? `С возвращением, ${team.name}` : 'Твоя идея заслуживает старта'}
            <span className="heading-dot">.</span>
          </h1>
          <p>Место, где школьная проблема превращается в настоящий проект.</p>
        </div>
        <Badge tone="green" dot>
          Сезон 2026 открыт
        </Badge>
      </div>
      <section className="hero-grid">
        <div className="hero">
          <div className="hero-copy">
            <span className="hero-kicker">
              <Sparkles size={14} /> AI STARTIFY × SCHOOL SPRINT
            </span>
            <h2>
              Не просто идея.
              <br />
              Твой первый
              <br />
              <span>стартап.</span>
            </h2>
            <p>
              Пройди путь от «а что, если…» до проекта,
              <br className="desktop-break" /> который увидит мир. По одному шагу в день.
            </p>
            <div className="hero-actions">
              <Button variant="lime" onClick={() => navigate(team ? '/team' : '/join')}>
                {team ? 'Продолжить свой путь' : 'Начать свой стартап'}
                <ArrowRight size={17} />
              </Button>
              <button className="hero-secondary" onClick={() => navigate('/challenge')}>
                Как это работает <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="hero-proof">
              <span className="proof-icon">
                <Check size={12} />
              </span>{' '}
              Бесплатный старт <i /> Наставник на каждом этапе
            </div>
          </div>
          <div className="hero-visual">
            <img
              src="/images/startup-orbit.png"
              alt="Белая ракета с лаймовыми деталями на орбите вокруг школы стартапов"
            />
            <span className="floating-tag">
              <Sparkles size={14} /> Из идеи — в орбиту
            </span>
          </div>
        </div>
        <Card className="sprint-card">
          <div className="card-heading">
            <span className="icon-tile lime">
              <Flame size={19} />
            </span>
            <Badge tone="lime">7-DAY CHALLENGE</Badge>
          </div>
          <h2>
            Одна неделя.
            <br />
            Первый запуск.
          </h2>
          <p>
            От проблемы твоей школы —<br />к опубликованному проекту.
          </p>
          <div className="sprint-time">
            <Clock3 size={16} />
            <span>До конца спринта</span>
            <strong>{days} дней</strong>
          </div>
          <div className="mini-journey">
            {['Идея', 'Проверка', 'MVP', 'Питч', 'Публикация'].map((s, i) => (
              <div key={s} className={team?.steps[i]?.completed ? 'done' : ''}>
                <span>{team?.steps[i]?.completed ? <Check size={11} /> : i + 1}</span>
                <small>{s}</small>
              </div>
            ))}
          </div>
          <div className="sprint-reward">
            <Trophy size={23} />
            <div>
              <strong>Не только проект. Твой рост.</strong>
              <small>Опыт, портфолио и место в лиге школ</small>
            </div>
          </div>
          <Button variant="dark" className="full" onClick={() => navigate('/challenge')}>
            Войти в школьную лигу <ArrowRight size={16} />
          </Button>
        </Card>
      </section>
      <section className="stats-grid">
        {[
          [Users, data.stats.teams, 'Команд в спринте', 'Вместе создавать проще', 'purple'],
          [School, data.stats.schools, 'Школы-участники', 'Идей больше, когда мы вместе', 'orange'],
          [Globe2, data.stats.countries, 'Страны в лиге', 'Границы только на карте', 'blue'],
          [Rocket, data.stats.verified, 'Подтверждённых проекта', 'Настоящий результат, не клики', 'green'],
        ].map(([Icon, value, label, sub, tone]) => (
          <Card className="stat" key={label}>
            <div>
              <span className={`icon-tile ${tone}`}>
                <Icon size={19} />
              </span>
              <strong>{number(value)}</strong>
            </div>
            <h3>{label}</h3>
            <small>{sub}</small>
          </Card>
        ))}
      </section>
      <section className="dashboard-middle">
        <Card className="journey-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">ТВОЙ МАРШРУТ</span>
              <h2>Большой путь начинается здесь</h2>
            </div>
            <Badge tone="purple">{completed} / 5 этапов</Badge>
          </div>
          <p className="muted">Никакого «придумай миллиардный бизнес». Просто следующий понятный шаг.</p>
          <div className="journey-steps">
            {data.steps.map((step, i) => {
              const Icon = icons[i];
              return (
                <button
                  key={step.index}
                  className={`journey-step ${team?.steps[i].completed ? 'done' : ''}`}
                  onClick={() => navigate(team ? `/team?step=${step.index}` : '/join')}
                >
                  <span className="journey-icon">
                    {team?.steps[i].completed ? <Check size={21} /> : <Icon size={21} />}
                  </span>
                  <strong>{step.short}</strong>
                  <small>Этап 0{step.index}</small>
                </button>
              );
            })}
          </div>
          <div className="journey-bottom">
            <span>
              <Compass size={17} />
              {team
                ? `Следующий шаг: ${data.steps[team.nextStep - 1].title}`
                : 'Твоя идея не должна быть идеальной, чтобы начать.'}
            </span>
            <button className="text-link" onClick={() => navigate(team ? '/team' : '/join')}>
              В инкубатор <ArrowRight size={15} />
            </button>
          </div>
        </Card>
        <Card className="leader-card">
          <div className="card-heading">
            <h2>
              <Trophy size={19} /> На орбите лиги
            </h2>
            <button
              className="icon-btn"
              aria-label="Вся школьная лига"
              onClick={() => navigate('/challenge')}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          <p className="muted">Школы, которые уже зажигают идеи</p>
          {data.leaderboard.schools.slice(0, 3).map((school, i) => (
            <div className="leader-row" key={school.id}>
              <span className={`leader-rank rank-${i}`}>{i === 0 ? <Trophy size={15} /> : `0${i + 1}`}</span>
              <span className={`school-avatar avatar-${i}`}>
                {school.name.replace('Демо-', '').slice(0, 1)}
              </span>
              <div>
                <strong>{school.name}</strong>
                <small>
                  {school.city} · {school.countryName}
                </small>
              </div>
              <b>
                {school.verified}
                <small>проект.</small>
              </b>
            </div>
          ))}
          <button className="leader-all" onClick={() => navigate('/challenge')}>
            Посмотреть весь рейтинг <ArrowRight size={15} />
          </button>
        </Card>
      </section>
      <section className="showcase-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">СОЗДАНО ШКОЛЬНИКАМИ</span>
            <h2>Маленькие команды. Заметные идеи.</h2>
          </div>
          <button className="text-link" onClick={() => navigate('/showcase')}>
            Все проекты <ArrowRight size={16} />
          </button>
        </div>
        <div className="project-grid">
          {data.projects.slice(0, 3).map((project) => (
            <ProjectCard key={project.id} project={project} navigate={navigate} />
          ))}
          {data.projects.length === 0 && (
            <Card className="full">
              <p>Здесь появятся первые подтверждённые проекты. Станьте первой командой!</p>
            </Card>
          )}
        </div>
      </section>
      <section className="growth-banner">
        <span className="growth-icon">
          <ChartIcon />
        </span>
        <div>
          <Badge tone="lime">GLOBAL GROWTH CHALLENGE</Badge>
          <h2>10 000 стартапов — это система, не случайность.</h2>
          <p>Исследование, воронка активации и план международного роста. Все допущения открыты.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/strategy')}>
          Открыть стратегию <ArrowUpRight size={17} />
        </Button>
      </section>
      <div className="dashboard-note">
        Учебные примеры помечены «Демо». Зачёт проверяется человеком. Последнее обновление данных:{' '}
        {formatDate(new Date().toISOString())}.
      </div>
    </>
  );
}
function ChartIcon() {
  return (
    <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
      <path
        d="M5 27V18M14 27V12M23 27V7M5 12l9-5 9 2 7-6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M24 3h6v6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
