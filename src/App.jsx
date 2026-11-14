import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Rocket,
  LayoutDashboard,
  Compass,
  Trophy,
  School,
  ChartNoAxesCombined,
  Settings2,
  CircleHelp,
  ChevronDown,
  ArrowUpRight,
  Search,
  Bell,
  Menu,
  X,
  Sparkles,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  Globe2,
} from 'lucide-react';
import { api, post } from './lib/api';
import { Badge, Button, Modal } from './components/UI';
import Dashboard from './pages/Dashboard';
import Incubator from './pages/Incubator';
import Showcase from './pages/Showcase';
import League from './pages/League';
import Strategy from './pages/Strategy';
import Organizer from './pages/Organizer';
import Join from './pages/Join';
import Teacher from './pages/Teacher';
import { useI18n, LANGUAGES } from './lib/i18n';

const navItems = (t) => [
  ['/', t('Обзор'), LayoutDashboard],
  ['/team', t('Мой инкубатор'), Compass],
  ['/showcase', t('Витрина стартапов'), Rocket],
  ['/challenge', t('Школьная лига'), Trophy],
  ['/strategy', t('Стратегия роста'), ChartNoAxesCombined],
];
const routeNow = () => window.location.hash.replace(/^#/, '') || '/';
export default function App() {
  const { t, tf, te, lang, setLang, loc } = useI18n();
  const NAV = navItems(t);
  const [fullRoute, setRoute] = useState(routeNow);
  const route = fullRoute.split('?')[0];
  const [data, setData] = useState(null),
    [me, setMe] = useState({ role: 'guest' });
  const [error, setError] = useState(''),
    [toast, setToast] = useState(null),
    [mobile, setMobile] = useState(false);
  const [profile, setProfile] = useState(false),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [langNotice, setLangNotice] = useState(true);
  const timer = useRef();
  const mobileQuery = () => window.matchMedia('(max-width: 900px)');
  const [smallScreen, setSmallScreen] = useState(() => mobileQuery().matches);
  useEffect(() => {
    const media = mobileQuery();
    const update = () => setSmallScreen(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobile || !smallScreen) return;
    const key = (e) => {
      if (e.key === 'Escape') setMobile(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [mobile, smallScreen]);

  const notify = useCallback((message, tone = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const navigate = useCallback((path) => {
    window.location.hash = path;
    setRoute(path);
    setMobile(false);
    setSearchOpen(false);
    setNotifications(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const refresh = useCallback(async () => {
    const [bootstrap, session] = await Promise.all([api('/api/bootstrap'), api('/api/me')]);
    setData(bootstrap);
    setMe(session);
    setError('');
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const onHash = () => {
      setRoute(routeNow());
      setMobile(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      clearTimeout(timer.current);
    };
  }, [refresh]);
  useEffect(() => {
    document.title = `${[...NAV, ['/organizer', t('Организатор')], ['/teacher', t('Кабинет школы')], ['/join', t('Вступить в спринт')]].find((n) => n[0] === route)?.[1] || t('Обзор')} · Startify Sprint`;
  }, [route]);
  async function demoLogin(role, targetId) {
    const body = {
      role,
      ...(role === 'team' ? { teamId: targetId } : role === 'teacher' ? { schoolId: targetId } : {}),
    };
    const target = role === 'organizer' ? '/organizer' : role === 'teacher' ? '/teacher' : '/team';
    const message =
      role === 'organizer'
        ? t('Открыт демо-кабинет организатора.')
        : role === 'teacher'
          ? t('Открыт демо-кабинет школы.')
          : t('Вы в демо-команде. Можно начинать!');
    try {
      await post('/api/demo/login', body);
      await refresh();
      setProfile(false);
      navigate(target);
      notify(message);
    } catch (e) {
      notify(te(e.message), 'error');
    }
  }
  async function markRead(reminderId) {
    try {
      await post(`/api/team/reminders/${reminderId}/read`, {});
      await refresh();
    } catch (e) {
      notify(te(e.message), 'error');
    }
  }
  async function logout() {
    try {
      await post('/api/logout', {});
      await refresh();
      setProfile(false);
      navigate('/');
    } catch (e) {
      notify(te(e.message), 'error');
    }
  }
  if (!data)
    return (
      <div className="boot">
        <span className="brand-symbol">
          <Sparkles size={28} />
        </span>
        <h2>Startify Sprint</h2>
        <p>{error || t('Готовим место для вашей большой идеи…')}</p>
        {error && <Button onClick={() => window.location.reload()}>{t('Попробовать снова')}</Button>}
      </div>
    );
  const ctx = { data, me, refresh, navigate, notify, demoLogin };
  const pages = {
    '/': <Dashboard {...ctx} />,
    '/team': <Incubator {...ctx} />,
    '/showcase': <Showcase {...ctx} />,
    '/challenge': <League {...ctx} />,
    '/leaderboard': <League {...ctx} />,
    '/strategy': <Strategy {...ctx} />,
    '/organizer': <Organizer {...ctx} />,
    '/teacher': <Teacher {...ctx} />,
    '/join': <Join {...ctx} />,
  };
  const unread = me.role === 'team' ? (me.team.reminders || []).filter((r) => !r.readAt) : [];
  const matches = search.trim()
    ? [
        ...NAV.map((n) => ({ title: n[1], route: n[0], type: t('Раздел') })),
        ...data.projects.map((p) => ({
          title: p.title,
          route: `/showcase?q=${encodeURIComponent(p.title)}`,
          type: t('Проект'),
        })),
      ]
        .filter((x) => x.title.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6)
    : [];
  return (
    <div className="shell">
      {mobile && (
        <button className="sidebar-scrim" aria-label={t('Закрыть меню')} onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? 'open' : ''}`} inert={smallScreen && !mobile ? '' : undefined}>
        <button className="brand" onClick={() => navigate('/')}>
          <span className="brand-symbol">
            <Sparkles size={23} fill="currentColor" />
          </span>
          <span>
            startify<span className="brand-sprint">SPRINT</span>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>{t('Школьная лига')}</strong>
            <small>{t('Международный сезон · 2026')}</small>
          </div>
          <Globe2 size={15} />
        </div>
        <span className="nav-label">{t('РАБОЧЕЕ ПРОСТРАНСТВО')}</span>
        <nav id="main-navigation" aria-label={t('Основная навигация')}>
          {NAV.map(([path, label, Icon]) => (
            <button
              key={path}
              className={`nav-item ${route === path || (path === '/challenge' && route === '/leaderboard') ? 'active' : ''}`}
              onClick={() => navigate(path)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === '/team' && (
                <span className="nav-count">
                  {me.role === 'team' ? `${me.team.steps.filter((s) => s.completed).length}/5` : '5'}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-season">
          <span className="mini-orbit">
            <Rocket size={22} />
          </span>
          <strong>
            {t('Большие идеи растут')}
            <br />
            {t('вместе.')}
          </strong>
          <p>
            {t('Брось вызов своей школе.')}
            <br />
            {t('Вдохнови другую.')}
          </p>
          <button onClick={() => navigate('/challenge')}>
            {t('Открыть лигу')} <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${route === '/teacher' ? 'active' : ''}`}
            onClick={() => navigate('/teacher')}
          >
            <School size={18} />
            Кабинет школы
            {unread.length > 0 && me.role === 'teacher' && <span className="nav-count">{unread.length}</span>}
          </button>
          <button
            className={`nav-item ${route === '/organizer' ? 'active' : ''}`}
            onClick={() => navigate('/organizer')}
          >
            <ShieldCheck size={18} />
            {t('Организатор')}
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            {t('Помощь и интеграции')}
          </button>
          <div className="sidebar-engine">
            <i className={data.llm.enabled ? 'online' : ''} />
            <span>{data.llm.enabled ? data.llm.model : t('Режим шаблонов')}</span>
            <button aria-label={t('Об интеграции SmallThinker')} onClick={() => setHelp(true)}>
              <Settings2 size={14} />
            </button>
          </div>
          <small className="sidebar-credit">{t('Сделано для больших начинаний.')}</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label={t('Открыть меню')}
              aria-expanded={mobile}
              aria-controls="main-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>{t('Рабочее пространство')}</span>
            <span className="slash">/</span>
            <strong>
              {[
                ...NAV,
                ['/organizer', t('Организатор')],
                ['/teacher', t('Кабинет школы')],
                ['/join', t('Вступить')],
              ].find((n) => n[0] === route)?.[1] || t('Обзор')}
            </strong>
          </div>
          <div className="top-actions">
            <div className="lang-switch" role="group" aria-label={t('Язык интерфейса')}>
              {LANGUAGES.map(([code, label]) => (
                <button
                  key={code}
                  className={lang === code ? 'active' : ''}
                  aria-pressed={lang === code}
                  title={label}
                  onClick={() => setLang(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label={t('Поиск по проектам и разделам')}
                placeholder={t('Найти что-нибудь…')}
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                  if (e.key === 'Enter' && matches[0]) navigate(matches[0].route);
                }}
              />
              {searchOpen && search && (
                <div className="search-results">
                  {matches.length ? (
                    matches.map((m) => (
                      <button key={m.route} onClick={() => navigate(m.route)}>
                        <span>
                          {m.title}
                          <small>{m.type}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))
                  ) : (
                    <p>{t('Ничего не найдено')}</p>
                  )}
                </div>
              )}
            </div>
            <div className="notification-wrap">
              <button
                className="icon-btn bell"
                aria-label={
                  unread.length
                    ? tf('Уведомления: {count} новых', { count: unread.length })
                    : t('Уведомления')
                }
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                {unread.length > 0 && <i className="has-unread" />}
              </button>
              {notifications && (
                <div className="notification-panel">
                  <strong>{t('Ваш спринт')}</strong>
                  {unread.length > 0 && (
                    <div className="notification-list">
                      {unread.map((r) => (
                        <div className="notification-item" key={r.id}>
                          <Badge tone="purple">
                            {r.authorRole === 'teacher' ? t('Координатор школы') : t('Организатор')}
                          </Badge>
                          <p>{r.message}</p>
                          <button className="text-link" onClick={() => markRead(r.id)}>
                            {t('Прочитано')} <CheckCircle2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p>
                    {me.role === 'team'
                      ? tf('Пройдено {done} из 5 этапов. {next}', {
                          done: me.team.steps.filter((s) => s.completed).length,
                          next:
                            me.team.submission?.status === 'returned'
                              ? t('Проект ждёт доработки.')
                              : t('Следующий маленький шаг уже ждёт в инкубаторе.'),
                        })
                      : me.role === 'teacher'
                        ? t('Откройте кабинет школы: там видно, какие команды застряли.')
                        : t('Соберите команду и превратите школьную проблему в первый стартап.')}
                  </p>
                  <button
                    className="text-link"
                    onClick={() =>
                      navigate(me.role === 'team' ? '/team' : me.role === 'teacher' ? '/teacher' : '/join')
                    }
                  >
                    {t('Продолжить')} <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="profile-wrap">
              <button className="profile-button" onClick={() => setProfile(!profile)}>
                <span className="avatar">
                  {me.role === 'team'
                    ? me.team.name.slice(0, 2).toUpperCase()
                    : me.role === 'organizer'
                      ? t('ОР')
                      : me.role === 'teacher'
                        ? t('КШ')
                        : 'ST'}
                </span>
                <span className="profile-name">
                  {me.role === 'team'
                    ? me.team.name
                    : me.role === 'organizer'
                      ? t('Организатор')
                      : me.role === 'teacher'
                        ? me.school.name
                        : t('Начать путь')}
                  <small>
                    {me.role === 'guest'
                      ? t('Гость пространства')
                      : me.role === 'team'
                        ? t('Моя команда')
                        : me.role === 'teacher'
                          ? t('Координатор школы')
                          : t('Управление лигой')}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  {data.demoMode && (
                    <>
                      <span className="menu-caption">{t('ДЕМО-ПРОСТРАНСТВО')}</span>
                      <button onClick={() => demoLogin('team')}>
                        <Compass size={16} />
                        {t('Демо-команда')}
                      </button>
                      <button onClick={() => demoLogin('organizer')}>
                        <ShieldCheck size={16} />
                        {t('Демо-организатор')}
                      </button>
                      <button onClick={() => demoLogin('teacher')}>
                        <School size={16} />
                        {t('Демо-координатор')}
                      </button>
                    </>
                  )}
                  {me.role === 'guest' ? (
                    <button onClick={() => navigate('/join')}>
                      <ArrowRight size={16} />
                      {t('Вступить / войти')}
                    </button>
                  ) : (
                    <button onClick={logout}>
                      <LogOut size={16} />
                      {t('Выйти')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="demo-strip">
          <span>
            <Sparkles size={13} />
            {data.demoMode
              ? t('Демо-пространство · учебные команды и проекты, не статистика всей платформы')
              : t('Пилотный сезон · публикация подтверждается организатором вручную')}
          </span>
          <button onClick={() => setHelp(true)}>
            {t('Как это работает')} <ArrowUpRight size={13} />
          </button>
        </div>
        {lang === 'en' && langNotice && ['/teacher', '/organizer', '/strategy'].includes(route) && (
          <div className="lang-note" role="status">
            <Globe2 size={16} />
            <span>
              {t('Кабинеты координатора, организатора и стратегия пока доступны только на русском языке.')}{' '}
              {t('Английский интерфейс покрывает путь школьника: регистрация, спринт, публикация и лига.')}
            </span>
            <button className="text-link" onClick={() => setLangNotice(false)}>
              {t('Понятно')}
            </button>
          </div>
        )}
        <main className={`main page-${route.slice(1) || 'home'}`}>
          <React.Fragment key={fullRoute}>{pages[route] || <Dashboard {...ctx} />}</React.Fragment>
        </main>
        <footer className="footer">
          <span>{t('© 2026 Startify Sprint · Команда Undefined')}</span>
          <span>
            AI Startify Global Growth Challenge <i /> Activation, not just registration.
          </span>
        </footer>
      </div>
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.tone === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span>{toast.message}</span>
          <button aria-label={t('Закрыть уведомление')} onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title={t('Ваш путь и интеграции')} onClose={() => setHelp(false)} wide>
          <div className="help-content">
            <Badge tone="green">{t('Честный MVP · без выдуманного API')}</Badge>
            <h3>{t('Идея → работа → публикация → зачёт')}</h3>
            <p>
              {t(
                'Заполняйте заметки, проверяйте гипотезы и готовьте проект. На пятом этапе отправьте ссылку на паспорт AI Startify. Организатор проверяет её вручную; только после этого проект попадает в рейтинг.',
              )}
            </p>
            <h3>{t('SmallThinker · серверный адаптер')}</h3>
            <p>
              {t(
                'Адаптер работает с OpenAI-compatible API. Рекомендуемый путь для SmallThinker — llama.cpp; поддержку в Ollama/vLLM проверяйте для своей версии. По умолчанию модель отключена: помощник возвращает явно помеченные учебные шаблоны, а не выдуманные AI-ответы.',
              )}
            </p>
            <pre>
              {
                'LLM_ENABLED=true\nLLM_BASE_URL=http://127.0.0.1:8080/v1\nLLM_MODEL=smallthinker\nLLM_RESPONSE_FORMAT=none'
              }
            </pre>
            <p>
              {t(
                'Укажите точный ID модели вашего сервера. Ключи хранятся только на сервере. Ответы проверяются по JSON-схеме; применение черновика — отдельное действие команды. Полная инструкция:',
              )}{' '}
              <a href="/docs/SMALLTHINKER.md" target="_blank" rel="noreferrer">
                docs/SMALLTHINKER.md ↗
              </a>
              .
            </p>
            <h3>{t('Данные несовершеннолетних')}</h3>
            <p>
              {t(
                'Используйте nickname и учебные данные. Не добавляйте телефоны, адреса и персональные данные. Это пилотная технология, а не юридически завершённый сервис для массового запуска детьми.',
              )}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setHelp(false);
                navigate('/strategy');
              }}
            >
              {t('Исследование и стратегия')} <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
