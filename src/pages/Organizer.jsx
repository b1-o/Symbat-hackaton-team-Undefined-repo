import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Download,
  Users,
  Rocket,
  Send,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  Cpu,
  ChevronDown,
  ArrowRight,
  Search,
} from 'lucide-react';
import { Badge, Button, Card, Empty, Field, SectionHead, Status } from '../components/UI';
import { api, post } from '../lib/api';
export default function Organizer({ data, me, refresh, notify, demoLogin }) {
  const [org, setOrg] = useState(null),
    [includeDemo, setIncludeDemo] = useState(true),
    [comments, setComments] = useState({}),
    [checks, setChecks] = useState({}),
    [busy, setBusy] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const requestVersion = React.useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (me.role !== 'organizer') return;
    try {
      const result = await api(`/api/organizer?includeDemo=${includeDemo}`);
      if (version === requestVersion.current) {
        setOrg(result);
        setError('');
      }
    } catch (e) {
      if (version === requestVersion.current) setError(e.message);
    }
  }, [me.role, includeDemo]);
  useEffect(() => {
    load();
  }, [load]);
  async function loadMore(kind) {
    setBusy(kind);
    try {
      const offset = kind === 'teams' ? org.page.nextTeamsOffset : org.page.nextPendingOffset;
      const r = await api(`/api/organizer?includeDemo=${includeDemo}&limit=50&offset=${offset}`);
      setOrg((old) => ({
        ...r,
        teams: kind === 'teams' ? [...old.teams, ...r.teams] : r.teams,
        pending: kind === 'pending' ? [...old.pending, ...r.pending] : r.pending,
        page: {
          ...old.page,
          ...(kind === 'teams'
            ? { nextTeamsOffset: r.page.nextTeamsOffset }
            : { nextPendingOffset: r.page.nextPendingOffset }),
        },
      }));
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function review(id, decision) {
    setBusy(id);
    try {
      await post(`/api/organizer/submissions/${id}/review`, {
        decision,
        comment: comments[id] || '',
        checklist: checks[id] || {},
      });
      await Promise.all([load(), refresh()]);
      notify(
        decision === 'approve'
          ? 'Публикация подтверждена. Рейтинг обновлен.'
          : 'Проект возвращён с комментарием.',
      );
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function login(e) {
    e.preventDefault();
    setBusy('login');
    try {
      await post('/api/auth/organizer', { password });
      await refresh();
      setPassword('');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function testLlm() {
    setBusy('llm');
    try {
      const r = await post('/api/organizer/llm/test', {});
      notify(`Модель ${r.model} ответила за ${(r.latency / 1000).toFixed(1)} с. JSON прошёл проверку.`);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function exportCsv() {
    try {
      const r = await fetch(`/api/organizer/export.csv?includeDemo=${includeDemo}`);
      if (!r.ok) throw new Error('Не удалось выгрузить CSV.');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'startify-funnel.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  if (me.role !== 'organizer')
    return (
      <>
        <SectionHead
          eyebrow="ДЛЯ ТЕХ, КТО ЗАЖИГАЕТ ИДЕИ"
          title="Кабинет организатора"
          text="Видеть весь путь команды. Помогать вовремя. Считать подтверждённый результат."
        />
        <Card className="auth-card">
          <ShieldCheck size={35} />
          <h2>Вход для организатора</h2>
          <form onSubmit={login}>
            <Field label="Пароль организатора">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button busy={busy === 'login'}>
              Войти <ArrowRight size={16} />
            </Button>
          </form>
          {data.demoMode && (
            <Button variant="ghost" onClick={() => demoLogin('organizer')}>
              Посмотреть демо-кабинет
            </Button>
          )}
          <p className="muted small">
            В production демо-вход по умолчанию отключён. Пароль задаётся на сервере.
          </p>
        </Card>
      </>
    );
  return (
    <>
      <SectionHead
        eyebrow="ПАНЕЛЬ ОРГАНИЗАТОРА"
        title="От интереса — к результату"
        text="Живые данные этого пилота. Они не выдаются за статистику всей платформы AI Startify."
      >
        <Button variant="ghost" onClick={exportCsv}>
          <Download size={16} />
          Экспорт CSV
        </Button>
        <Button variant="ghost" busy={!!busy && !org} onClick={load}>
          <RefreshCw size={16} />
          Обновить
        </Button>
      </SectionHead>
      <div className="org-toolbar">
        <label className="toggle-label">
          <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
          Включая демо-команды
        </label>
        <Badge tone={includeDemo ? 'amber' : 'green'}>
          {includeDemo ? 'Учебные данные включены' : 'Только реальные команды пилота'}
        </Badge>
      </div>
      {error && (
        <div className="notice warning">
          {error}{' '}
          <button className="text-link" onClick={load}>
            Повторить
          </button>
        </div>
      )}
      {!org ? (
        <Card>Загрузка данных…</Card>
      ) : (
        <>
          <div className="funnel-grid">
            {[
              [Users, 'Создано команд', org.funnel.total, '100%'],
              [
                Rocket,
                'Начали работу',
                org.funnel.started,
                `${org.funnel.total ? Math.round((org.funnel.started / org.funnel.total) * 100) : 0}%`,
              ],
              [
                Send,
                'Отправили паспорт',
                org.funnel.submitted,
                `${org.funnel.total ? Math.round((org.funnel.submitted / org.funnel.total) * 100) : 0}%`,
              ],
              [CheckCircle2, 'Подтверждено', org.funnel.approved, `${org.funnel.conversion}%`],
            ].map(([Icon, label, value, pct], i) => (
              <Card className="funnel-stat" key={label}>
                <span className={`icon-tile ${['purple', 'blue', 'orange', 'green'][i]}`}>
                  <Icon size={19} />
                </span>
                <small>{label}</small>
                <strong>{value}</strong>
                <div className="funnel-bar">
                  <span style={{ width: `${org.funnel.total ? (value / org.funnel.total) * 100 : 0}%` }} />
                </div>
                <span>{pct} от созданных команд</span>
              </Card>
            ))}
          </div>
          <div className="org-summary">
            <span>
              <Clock3 size={16} />
              На проверке: <b>{org.funnel.pending}</b>
            </span>
            <span>
              Возвращено: <b>{org.funnel.returned}</b>
            </span>
            <span>
              Команд по приглашению: <b>{org.referrals}</b>
            </span>
            <span>
              Зачётов по приглашению: <b>{org.referralsApproved}</b>
            </span>
            <span>
              LLM-ответов: <b>{org.usage.llm_success || 0}</b>
            </span>
          </div>
          <Card className="activation-metrics">
            <h2>Качество активации</h2>
            <div>
              <span>
                Медиана до первой заметки
                <strong>
                  {org.activation.medianFirstValueMinutes === null
                    ? 'Нет данных'
                    : `${org.activation.medianFirstValueMinutes.toFixed(1)} мин`}
                </strong>
                <small>Команд с замером: {org.activation.measuredTeams}</small>
              </span>
              <span>
                D7 retention
                <strong>
                  {org.activation.d7Percent === null
                    ? 'Когорта ещё не созрела'
                    : `${org.activation.d7Percent}%`}
                </strong>
                <small>
                  Зрелых когорт: {org.activation.d7Eligible}; вернулись: {org.activation.d7Returned}
                </small>
              </span>
            </div>
            <p className="muted small">
              События пишутся сервером. Для старых демо-команд история не выдумывается. D7 — возврат на 6–8-й
              день после первой заметки, только для когорт возрастом от 8 дней.
            </p>
          </Card>
          <Card className="review-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">ЧЕЛОВЕК ПРИНИМАЕТ РЕШЕНИЕ</span>
                <h2>Очередь проверки</h2>
              </div>
              <Badge tone="amber">{org.funnel.pending} ожидают</Badge>
            </div>
            <p className="muted">
              Откройте паспорт, сверьте с заметками и подтвердите пункты. AI не может подтвердить публикацию.
            </p>
            {!org.pending.length && (
              <Empty
                title="Все проекты разобраны"
                text="Новые заявки появятся здесь после отправки командой."
              />
            )}
            {org.pending.map((item) => (
              <article className="review-card" key={item.id}>
                <div className="card-heading">
                  <div>
                    <h3>
                      {item.title} {item.is_demo && <Badge>Демо</Badge>}
                    </h3>
                    <p className="muted small">
                      {item.team_name} · {item.school_name} · {item.countryName}
                    </p>
                  </div>
                  <Status submission={item} />
                </div>
                <p>{item.description}</p>
                <a
                  className="text-link passport-link"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.url}
                  <ExternalLink size={14} />
                </a>
                <details className="review-evidence">
                  <summary>
                    Рабочая тетрадь команды <ChevronDown size={15} />
                  </summary>
                  {item.workbook.map((w) => (
                    <div key={w.step_index}>
                      <strong>
                        Этап {w.step_index} {item.steps.includes(w.step_index) ? '· завершён' : '· черновик'}
                      </strong>
                      <p>{w.content || 'Пусто'}</p>
                    </div>
                  ))}
                </details>
                <Field
                  label="Комментарий команде"
                  hint="Обязателен при возврате. Объясните конкретный следующий шаг."
                >
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={comments[item.id] || ''}
                    onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))}
                    placeholder="Что проверено и что нужно улучшить…"
                  />
                </Field>
                <div className="review-checks">
                  {[
                    ['accessible', 'Паспорт доступен'],
                    ['original', 'Не дублирует другой проект'],
                    ['safe', 'Без личных данных и опасного содержания'],
                    ['complete', 'Проблема, решение и материалы заполнены'],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={checks[item.id]?.[key] || false}
                        onChange={(e) =>
                          setChecks((c) => ({ ...c, [item.id]: { ...c[item.id], [key]: e.target.checked } }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {item.is_demo && (
                  <small className="muted">
                    Демо-зачёт проверяет только работу интерфейса. Он не подтверждает существование учебного
                    паспорта.
                  </small>
                )}
                <div className="review-actions">
                  <Button
                    busy={busy === item.id}
                    disabled={Object.values(checks[item.id] || {}).filter(Boolean).length !== 4}
                    onClick={() => review(item.id, 'approve')}
                  >
                    <ShieldCheck size={16} />
                    Подтвердить публикацию
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === item.id || (comments[item.id] || '').trim().length < 3}
                    onClick={() => review(item.id, 'return')}
                  >
                    Вернуть на доработку
                  </Button>
                </div>
              </article>
            ))}
            {org.page.nextPendingOffset !== null && (
              <Button variant="ghost" busy={busy === 'pending'} onClick={() => loadMore('pending')}>
                Показать ещё заявки
              </Button>
            )}
          </Card>
          <div className="organizer-bottom">
            <Card>
              <div className="card-heading">
                <h2>Команды потока</h2>
                <div className="search-input compact">
                  <Search size={15} />
                  <input
                    aria-label="Поиск команды"
                    placeholder="Поиск среди загруженных команд"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Команда</th>
                      <th>Школа</th>
                      <th>Этапы</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.teams
                      .filter((t) => `${t.name} ${t.school_name}`.toLowerCase().includes(query.toLowerCase()))
                      .map((t) => (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.name}</strong>
                            {t.is_demo && <Badge>Демо</Badge>}
                            <small className="table-sub">{t.nickname}</small>
                          </td>
                          <td>
                            {t.school_name}
                            <small className="table-sub">{t.countryName}</small>
                          </td>
                          <td>{t.steps_completed}/5</td>
                          <td>
                            <Status
                              submission={t.submission_status ? { status: t.submission_status } : null}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {org.page.nextTeamsOffset !== null && (
                  <Button variant="ghost" busy={busy === 'teams'} onClick={() => loadMore('teams')}>
                    Показать ещё команды
                  </Button>
                )}
              </div>
            </Card>
            <Card className="llm-health">
              <span className="icon-tile purple">
                <Cpu size={23} />
              </span>
              <h2>Подключение SmallThinker</h2>
              <Badge tone={data.llm.enabled ? 'green' : 'neutral'} dot>
                {data.llm.enabled ? 'Адаптер включён' : 'Режим шаблонов'}
              </Badge>
              <p>
                {data.llm.enabled
                  ? `Модель: ${data.llm.model}. Проверка отправит один тестовый запрос.`
                  : 'Чтобы включить модель, задайте LLM_ENABLED=true и параметры endpoint на сервере.'}
              </p>
              <dl>
                <dt>Успешных ответов</dt>
                <dd>{org.usage.llm_success || 0}</dd>
                <dt>Средняя задержка</dt>
                <dd>{org.usage.latency_ms ? `${(org.usage.latency_ms / 1000).toFixed(1)} с` : '—'}</dd>
                <dt>Вход / выход токенов</dt>
                <dd>
                  {org.usage.prompt_tokens || 0} / {org.usage.completion_tokens || 0}
                </dd>
              </dl>
              <Button variant="ghost" disabled={!data.llm.enabled} busy={busy === 'llm'} onClick={testLlm}>
                Проверить подключение
              </Button>
              <small className="muted">
                Инструкция:{' '}
                <a href="/docs/SMALLTHINKER.md" target="_blank" rel="noreferrer">
                  docs/SMALLTHINKER.md ↗
                </a>
              </small>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
