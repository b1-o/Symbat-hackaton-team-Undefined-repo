import React, { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Trophy, Users, School, Globe2, CheckCircle2, Circle, ExternalLink,
  Send, Copy, ShieldCheck, LayoutDashboard, ArrowRight, Sparkles, AlertCircle, Flag
} from 'lucide-react';

const AI_STARTIFY_URL = 'https://aistartify.com/';

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
}

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Header({ route, me, navigate, demoLogin, logout }) {
  const links = [
    ['/', 'Челлендж'],
    ['/leaderboard', 'Рейтинг'],
    ['/team', 'Моя команда'],
    ['/organizer', 'Организатор']
  ];
  return (
    <>
      <div className="demo-banner">
        <span><Sparkles size={14} /> Демо-режим: учебные данные, без реальной интеграции с AI Startify</span>
        <div className="demo-actions">
          <button onClick={() => demoLogin('team')}>Демо-команда</button>
          <button onClick={() => demoLogin('organizer')}>Демо-организатор</button>
          {me.role !== 'guest' && <button onClick={logout}>Выйти</button>}
        </div>
      </div>
      <header className="header">
        <button className="brand" onClick={() => navigate('/')}>
          <span className="brand-mark"><Rocket size={20} /></span>
          <span>Startify Sprint</span>
        </button>
        <nav className="nav">
          {links.map(([path, label]) => (
            <button key={path} className={route === path ? 'active' : ''} onClick={() => navigate(path)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="header-role">
          {me.role === 'team' && <Badge tone="blue">{me.team?.name}</Badge>}
          {me.role === 'organizer' && <Badge tone="purple">Организатор</Badge>}
          {me.role === 'guest' && <Badge>Гость</Badge>}
        </div>
      </header>
    </>
  );
}

function Landing({ data, me, navigate }) {
  const challenge = data.challenge;
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.ends_at) - new Date()) / 86400000));
  return (
    <main>
      <section className="hero">
        <div className="hero-content">
          <Badge tone="blue">Международный школьный спринт</Badge>
          <h1>{challenge.title}</h1>
          <p className="lead">{challenge.description}</p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => navigate(me.role === 'team' ? '/team' : '/join')}>
              {me.role === 'team' ? 'Открыть мою команду' : 'Вступить по приглашению'} <ArrowRight size={18} />
            </button>
            <button className="btn ghost" onClick={() => navigate('/leaderboard')}>
              <Trophy size={18} /> Рейтинг школ
            </button>
          </div>
          <div className="hero-meta">
            <span><Flag size={16} /> До завершения: {daysLeft} дн.</span>
            <span><ShieldCheck size={16} /> В зачёт идут только подтверждённые публикации</span>
          </div>
        </div>
        <div className="hero-panel">
          <h3>Как это работает</h3>
          <ol className="flow-list">
            <li><span>1</span> Учитель запускает спринт в классе</li>
            <li><span>2</span> Команда проходит этапы в AI Startify</li>
            <li><span>3</span> Отправляет ссылку на опубликованный проект</li>
            <li><span>4</span> Организатор подтверждает публикацию</li>
            <li><span>5</span> Школа получает место в рейтинге</li>
          </ol>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard icon={Users} label="Команд" value={data.stats.teams} />
        <StatCard icon={School} label="Школ" value={data.stats.schools} />
        <StatCard icon={Globe2} label="Стран" value={data.stats.countries} />
        <StatCard icon={CheckCircle2} label="Подтверждённых проектов" value={data.stats.verified} />
      </section>

      <section className="section two-col">
        <div className="card">
          <div className="card-head">
            <h2>Топ школ</h2>
            <button className="link-btn" onClick={() => navigate('/leaderboard')}>Весь рейтинг</button>
          </div>
          <SchoolTable rows={data.leaderboard.schools.slice(0, 5)} compact />
        </div>
        <div className="card">
          <div className="card-head"><h2>Подтверждённые проекты</h2></div>
          {data.projects.length === 0 && <p className="muted">Проекты появятся после проверки организатором.</p>}
          <div className="project-list">
            {data.projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        </div>
      </section>
    </main>
  );
}

function ProjectCard({ project }) {
  return (
    <article className="project-card">
      <div className="project-top">
        <h3>{project.title}</h3>
        {project.is_demo && <Badge>Демо</Badge>}
      </div>
      <p className="muted">{project.team_name} · {project.school_name} · {project.countryName}</p>
      <p>{project.description}</p>
      <a className="link-btn" href={project.url} target="_blank" rel="noreferrer">
        Открыть в AI Startify <ExternalLink size={14} />
      </a>
    </article>
  );
}

function SchoolTable({ rows, compact = false, onChallenge }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Школа</th>
            {!compact && <th>Страна</th>}
            <th>Команды</th>
            <th>Подтверждено</th>
            {onChallenge && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className={`rank rank-${row.rank}`}>{row.rank}</span></td>
              <td>
                <strong>{row.name}</strong> {row.isDemo && <Badge>Демо</Badge>}
                <div className="muted small">{row.city}</div>
              </td>
              {!compact && <td>{row.countryName}</td>}
              <td>{row.teams}</td>
              <td><strong className="verified-count">{row.verified}</strong></td>
              {onChallenge && (
                <td><button className="btn tiny" onClick={() => onChallenge(row.id)}><Copy size={14} /> Вызов</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JoinPage({ data, onJoined, toast }) {
  const params = new URLSearchParams(window.location.search);
  const fromSchoolId = params.get('from') || '';
  const invitingSchool = data.schools.find((school) => school.id === fromSchoolId);
  const [form, setForm] = useState({
    accessCode: data.challenge.access_code,
    countryCode: 'KZ',
    schoolName: '',
    city: '',
    teamName: '',
    nickname: ''
  });
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/teams', { method: 'POST', body: JSON.stringify({ ...form, fromSchoolId }) });
      toast('Команда создана. Добро пожаловать в спринт!');
      onJoined();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <div className="card">
        <Badge tone="blue">Вход в спринт</Badge>
        <h1>Соберите команду школы</h1>
        <p className="muted">Демо-форма не собирает реальные персональные данные школьников. Используйте nickname и учебное название школы.</p>
        {invitingSchool && <div className="notice">Вас пригласила школа: <strong>{invitingSchool.name}</strong></div>}
        <form onSubmit={submit} className="form-grid">
          <label>Код приглашения
            <input value={form.accessCode} onChange={(e) => update('accessCode', e.target.value)} required />
          </label>
          <label>Страна
            <select value={form.countryCode} onChange={(e) => update('countryCode', e.target.value)}>
              {data.countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </label>
          <label>Школа
            <input list="schools" value={form.schoolName} onChange={(e) => update('schoolName', e.target.value)} placeholder="Например, Демо-лицей №1" required />
            <datalist id="schools">
              {data.schools.map((school) => <option key={school.id} value={school.name} />)}
            </datalist>
          </label>
          <label>Город
            <input value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="Алматы" />
          </label>
          <label>Название команды
            <input value={form.teamName} onChange={(e) => update('teamName', e.target.value)} placeholder="EcoSchool" required />
          </label>
          <label>Nickname участника
            <input value={form.nickname} onChange={(e) => update('nickname', e.target.value)} placeholder="Без ФИО" required />
          </label>
          <button className="btn primary full" disabled={busy}>{busy ? 'Создаём…' : 'Создать команду и начать'}</button>
        </form>
      </div>
    </main>
  );
}

function TeamPage({ me, refresh, navigate, toast, demoLogin }) {
  if (me.role !== 'team') {
    return (
      <main className="narrow">
        <div className="card center">
          <h1>Кабинет команды</h1>
          <p className="muted">Войдите по приглашению или откройте демо-команду.</p>
          <div className="hero-actions center-actions">
            <button className="btn primary" onClick={() => navigate('/join')}>Вступить</button>
            <button className="btn ghost" onClick={() => demoLogin('team')}>Демо-команда</button>
          </div>
        </div>
      </main>
    );
  }
  return <TeamWorkspace team={me.team} refresh={refresh} toast={toast} />;
}

function TeamWorkspace({ team, refresh, toast }) {
  const [busyStep, setBusyStep] = useState(null);
  const submission = team.submission;
  const [form, setForm] = useState({ title: '', url: '', description: '' });

  useEffect(() => {
    if (submission?.status === 'returned') {
      setForm({ title: submission.title, url: submission.url, description: submission.description });
    }
  }, [submission?.id, submission?.status]);

  const completedCount = team.steps.filter((step) => step.completed).length;
  const progress = Math.round((completedCount / team.steps.length) * 100);

  async function toggleStep(step) {
    if (step.index === 5) return;
    setBusyStep(step.index);
    try {
      await api('/api/team/steps', { method: 'PATCH', body: JSON.stringify({ stepIndex: step.index, completed: !step.completed }) });
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusyStep(null);
    }
  }

  async function submitProject(event) {
    event.preventDefault();
    try {
      await api('/api/team/submission', { method: 'POST', body: JSON.stringify(form) });
      toast('Проект отправлен на проверку.');
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function inviteSchool() {
    const link = `${window.location.origin}/?from=${team.school.id}#/join`;
    const ok = await copyText(link);
    toast(ok ? 'Ссылка-вызов скопирована.' : `Ссылка: ${link}`, ok ? 'success' : 'error');
  }

  return (
    <main>
      <section className="page-head">
        <div>
          <Badge tone="blue">{team.school.countryName}</Badge>
          <h1>{team.name}</h1>
          <p className="muted">{team.school.name} · {team.school.city} · участник: {team.nickname}</p>
        </div>
        <button className="btn ghost" onClick={inviteSchool}><Copy size={16} /> Бросить вызов другой школе</button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Прогресс спринта</h2>
          <strong>{completedCount} / {team.steps.length}</strong>
        </div>
        <div className="progress-bar"><div style={{ width: `${progress}%` }} /></div>
        <div className="steps-grid">
          {team.steps.map((step) => (
            <button
              key={step.index}
              className={`step-card ${step.completed ? 'done' : ''} ${team.nextStep === step.index ? 'next' : ''}`}
              onClick={() => toggleStep(step)}
              disabled={step.index === 5 || busyStep === step.index}
            >
              <div className="step-icon">{step.completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}</div>
              <div>
                <strong>{step.index}. {step.title}</strong>
                <p>{step.description}</p>
                {step.index === 5 && <span className="muted small">Подтверждается организатором после проверки ссылки.</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="hero-actions">
          <a className="btn primary" href={AI_STARTIFY_URL} target="_blank" rel="noreferrer">
            Открыть AI Startify <ExternalLink size={16} />
          </a>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Публикация проекта</h2><SubmissionBadge submission={submission} /></div>
        {!submission && (
          <SubmissionForm form={form} setForm={setForm} onSubmit={submitProject} />
        )}
        {submission?.status === 'pending' && (
          <div className="notice">
            <strong>{submission.title}</strong> отправлен на проверку. Организатор проверит ссылку вручную.
            <div className="muted small">{submission.url}</div>
          </div>
        )}
        {submission?.status === 'approved' && (
          <div className="notice success">
            <strong>{submission.title}</strong> подтверждён и попал в рейтинг школы.
            <div><a className="link-btn" href={submission.url} target="_blank" rel="noreferrer">Открыть ссылку <ExternalLink size={14} /></a></div>
          </div>
        )}
        {submission?.status === 'returned' && (
          <>
            <div className="notice warning"><strong>Нужна доработка:</strong> {submission.review_comment}</div>
            <SubmissionForm form={form} setForm={setForm} onSubmit={submitProject} />
          </>
        )}
      </section>
    </main>
  );
}

function SubmissionBadge({ submission }) {
  if (!submission) return <Badge>Не отправлен</Badge>;
  if (submission.status === 'pending') return <Badge tone="amber">На проверке</Badge>;
  if (submission.status === 'approved') return <Badge tone="green">Подтверждён</Badge>;
  return <Badge tone="red">Возвращён</Badge>;
}

function SubmissionForm({ form, setForm, onSubmit }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>Название проекта
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
      </label>
      <label>Ссылка на паспорт AI Startify
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://aistartify.com/startup/…" required />
      </label>
      <label className="full-width">Короткое описание
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <button className="btn primary"><Send size={16} /> Отправить на проверку</button>
    </form>
  );
}

function LeaderboardPage({ data, toast }) {
  const [tab, setTab] = useState('schools');
  const [country, setCountry] = useState('all');
  const schools = useMemo(() => {
    const rows = data.leaderboard.schools.filter((row) => country === 'all' || row.country_code === country);
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }, [data.leaderboard.schools, country]);

  async function challenge(schoolId) {
    const link = `${window.location.origin}/?from=${schoolId}#/join`;
    const ok = await copyText(link);
    toast(ok ? 'Ссылка-вызов скопирована.' : 'Не удалось скопировать ссылку.', ok ? 'success' : 'error');
  }

  return (
    <main>
      <section className="page-head">
        <div>
          <Badge tone="purple">Рейтинг</Badge>
          <h1>Школы, страны и проекты</h1>
          <p className="muted">Место определяется числом подтверждённых публикаций, а не регистраций.</p>
        </div>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="all">Все страны</option>
          {data.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </section>
      <div className="tabs">
        <button className={tab === 'schools' ? 'active' : ''} onClick={() => setTab('schools')}>Школы</button>
        <button className={tab === 'countries' ? 'active' : ''} onClick={() => setTab('countries')}>Страны</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Проекты</button>
      </div>
      {tab === 'schools' && <div className="card"><SchoolTable rows={schools} onChallenge={challenge} /></div>}
      {tab === 'countries' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>#</th><th>Страна</th><th>Школы</th><th>Команды</th><th>Подтверждено</th></tr></thead>
            <tbody>
              {data.leaderboard.countries.map((row) => (
                <tr key={row.country_code}>
                  <td><span className={`rank rank-${row.rank}`}>{row.rank}</span></td>
                  <td><strong>{row.countryName}</strong></td>
                  <td>{row.schools}</td><td>{row.teams}</td><td><strong className="verified-count">{row.verified}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'projects' && (
        <div className="project-grid">
          {data.projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </div>
      )}
    </main>
  );
}

function OrganizerPage({ me, demoLogin, refresh, toast }) {
  const [org, setOrg] = useState(null);
  const [comments, setComments] = useState({});
  const [busy, setBusy] = useState(null);

  async function load() {
    if (me.role !== 'organizer') return;
    try {
      setOrg(await api('/api/organizer'));
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  useEffect(() => { load(); }, [me.role]);

  async function review(id, decision) {
    setBusy(id);
    try {
      await api(`/api/organizer/submissions/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comments[id] || '' })
      });
      toast(decision === 'approve' ? 'Проект подтверждён.' : 'Проект возвращён на доработку.');
      setComments((prev) => ({ ...prev, [id]: '' }));
      await load();
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (me.role !== 'organizer') {
    return (
      <main className="narrow">
        <div className="card center">
          <LayoutDashboard size={32} />
          <h1>Кабинет организатора</h1>
          <p className="muted">Откройте демо-роль, чтобы увидеть воронку и очередь проверки.</p>
          <button className="btn primary" onClick={() => demoLogin('organizer')}>Открыть демо-организатора</button>
        </div>
      </main>
    );
  }

  if (!org) return <main className="narrow"><div className="card">Загрузка…</div></main>;

  return (
    <main>
      <section className="page-head">
        <div>
          <Badge tone="purple">Организатор</Badge>
          <h1>Прогресс потока и проверка</h1>
          <p className="muted">Главная метрика — подтверждённые публикации, а не регистрации.</p>
        </div>
      </section>
      <section className="stats-grid">
        <StatCard icon={Users} label="Команд" value={org.funnel.total} />
        <StatCard icon={Rocket} label="Начали спринт" value={org.funnel.started} />
        <StatCard icon={Send} label="Отправили проект" value={org.funnel.submitted} />
        <StatCard icon={CheckCircle2} label="Подтверждено" value={org.funnel.approved} />
      </section>
      <div className="notice">Конверсия в подтверждённую публикацию: <strong>{org.funnel.conversion}%</strong> · На проверке: {org.funnel.pending} · Возвращено: {org.funnel.returned}</div>

      <section className="card">
        <div className="card-head"><h2>Очередь проверки</h2><Badge tone="amber">{org.pending.length}</Badge></div>
        {org.pending.length === 0 && <p className="muted">Нет заявок на проверке.</p>}
        <div className="review-list">
          {org.pending.map((item) => (
            <article className="review-card" key={item.id}>
              <div className="project-top">
                <h3>{item.title} {item.is_demo && <Badge>Демо</Badge>}</h3>
                <SubmissionBadge submission={item} />
              </div>
              <p className="muted">{item.team_name} · {item.school_name} · {item.countryName}</p>
              <p>{item.description}</p>
              <a className="link-btn" href={item.url} target="_blank" rel="noreferrer">{item.url} <ExternalLink size={14} /></a>
              <textarea
                rows={2}
                placeholder="Комментарий для возврата на доработку"
                value={comments[item.id] || ''}
                onChange={(e) => setComments((prev) => ({ ...prev, [item.id]: e.target.value }))}
              />
              <div className="hero-actions">
                <button className="btn primary" disabled={busy === item.id} onClick={() => review(item.id, 'approve')}>
                  <ShieldCheck size={16} /> Подтвердить
                </button>
                <button className="btn ghost" disabled={busy === item.id} onClick={() => review(item.id, 'return')}>
                  <AlertCircle size={16} /> Вернуть
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Команды</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Команда</th><th>Школа</th><th>Шаги</th><th>Проект</th><th>Статус</th></tr></thead>
            <tbody>
              {org.teams.map((team) => (
                <tr key={team.id}>
                  <td><strong>{team.name}</strong><div className="muted small">{team.nickname}</div></td>
                  <td>{team.school_name}<div className="muted small">{team.countryName}</div></td>
                  <td>{team.steps_completed}/5</td>
                  <td>{team.submission_title || '—'}</td>
                  <td><SubmissionBadge submission={team.submission_status ? { status: team.submission_status } : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const [data, setData] = useState(null);
  const [me, setMe] = useState({ role: 'guest' });
  const [toastState, setToastState] = useState(null);

  function navigate(path) {
    window.location.hash = path;
    setRoute(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toast(message, tone = 'success') {
    setToastState({ message, tone });
    window.setTimeout(() => setToastState(null), 4000);
  }

  async function refresh() {
    const [bootstrap, session] = await Promise.all([api('/api/bootstrap'), api('/api/me')]);
    setData(bootstrap);
    setMe(session);
  }

  useEffect(() => {
    refresh().catch((error) => toast(error.message, 'error'));
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function demoLogin(role) {
    try {
      await api('/api/demo/login', { method: 'POST', body: JSON.stringify({ role }) });
      await refresh();
      navigate(role === 'organizer' ? '/organizer' : '/team');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' });
    await refresh();
    navigate('/');
  }

  if (!data) return <div className="loading">Загрузка Startify Sprint…</div>;

  let page;
  if (route === '/join') page = <JoinPage data={data} toast={toast} onJoined={async () => { await refresh(); navigate('/team'); }} />;
  else if (route === '/team') page = <TeamPage me={me} refresh={refresh} navigate={navigate} toast={toast} demoLogin={demoLogin} />;
  else if (route === '/leaderboard') page = <LeaderboardPage data={data} toast={toast} />;
  else if (route === '/organizer') page = <OrganizerPage me={me} demoLogin={demoLogin} refresh={refresh} toast={toast} />;
  else page = <Landing data={data} me={me} navigate={navigate} />;

  return (
    <div className="app">
      <Header route={route} me={me} navigate={navigate} demoLogin={demoLogin} logout={logout} />
      {page}
      <footer className="footer">
        Startify Sprint · MVP для Symbat Hackathon · Направление 2: Startup Creation & Activation
      </footer>
      {toastState && <div className={`toast toast-${toastState.tone}`}>{toastState.message}</div>}
    </div>
  );
}
