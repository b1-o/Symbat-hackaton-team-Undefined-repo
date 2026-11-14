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

const NAV = [
  ['/', 'Обзор', LayoutDashboard],
  ['/team', 'Мой инкубатор', Compass],
  ['/showcase', 'Витрина стартапов', Rocket],
  ['/challenge', 'Школьная лига', Trophy],
  ['/strategy', 'Стратегия роста', ChartNoAxesCombined],
];
const routeNow = () => window.location.hash.replace(/^#/, '') || '/';
export default function App() {
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
    document.title = `${[...NAV, ['/organizer', 'Организатор'], ['/join', 'Вступить в спринт']].find((n) => n[0] === route)?.[1] || 'Обзор'} · Startify Sprint`;
  }, [route]);
  async function demoLogin(role, teamId) {
    try {
      await post('/api/demo/login', { role, teamId });
      await refresh();
      setProfile(false);
      navigate(role === 'organizer' ? '/organizer' : '/team');
      notify(
        role === 'organizer' ? 'Открыт демо-кабинет организатора.' : 'Вы в демо-команде. Можно начинать!',
      );
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function logout() {
    try {
      await post('/api/logout', {});
      await refresh();
      setProfile(false);
      navigate('/');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  if (!data)
    return (
      <div className="boot">
        <span className="brand-symbol">
          <Sparkles size={28} />
        </span>
        <h2>Startify Sprint</h2>
        <p>{error || 'Готовим место для вашей большой идеи…'}</p>
        {error && <Button onClick={() => window.location.reload()}>Попробовать снова</Button>}
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
    '/join': <Join {...ctx} />,
  };
  const matches = search.trim()
    ? [
        ...NAV.map((n) => ({ title: n[1], route: n[0], type: 'Раздел' })),
        ...data.projects
          .filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
          .map((p) => ({
            title: p.title,
            route: `/showcase?q=${encodeURIComponent(p.title)}`,
            type: 'Проект',
          })),
      ].slice(0, 6)
    : [];
  return (
    <div className="shell">
      {mobile && (
        <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMobile(false)} />
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
            <strong>Школьная лига</strong>
            <small>Международный сезон · 2026</small>
          </div>
          <Globe2 size={15} />
        </div>
        <span className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <nav id="main-navigation" aria-label="Основная навигация">
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
            Большие идеи растут
            <br />
            вместе.
          </strong>
          <p>
            Брось вызов своей школе.
            <br />
            Вдохнови другую.
          </p>
          <button onClick={() => navigate('/challenge')}>
            Открыть лигу <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${route === '/organizer' ? 'active' : ''}`}
            onClick={() => navigate('/organizer')}
          >
            <ShieldCheck size={18} />
            Организатор
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            Помощь и интеграции
          </button>
          <div className="sidebar-engine">
            <i className={data.llm.enabled ? 'online' : ''} />
            <span>{data.llm.enabled ? data.llm.model : 'Режим шаблонов'}</span>
            <button aria-label="Об интеграции SmallThinker" onClick={() => setHelp(true)}>
              <Settings2 size={14} />
            </button>
          </div>
          <small className="sidebar-credit">Сделано для больших начинаний.</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Открыть меню"
              aria-expanded={mobile}
              aria-controls="main-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>Рабочее пространство</span>
            <span className="slash">/</span>
            <strong>
              {[...NAV, ['/organizer', 'Организатор'], ['/join', 'Вступить']].find(
                (n) => n[0] === route,
              )?.[1] || 'Обзор'}
            </strong>
          </div>
          <div className="top-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="Поиск по проектам и разделам"
                placeholder="Найти что-нибудь…"
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
                    <p>Ничего не найдено</p>
                  )}
                </div>
              )}
            </div>
            <div className="notification-wrap">
              <button
                className="icon-btn bell"
                aria-label="Уведомления"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                <i />
              </button>
              {notifications && (
                <div className="notification-panel">
                  <strong>Ваш спринт</strong>
                  <p>
                    {me.role === 'team'
                      ? `Пройдено ${me.team.steps.filter((s) => s.completed).length} из 5 этапов. ${me.team.submission?.status === 'returned' ? 'Проект ждёт доработки.' : 'Следующий маленький шаг уже ждёт в инкубаторе.'}`
                      : 'Соберите команду и превратите школьную проблему в первый стартап.'}
                  </p>
                  <button
                    className="text-link"
                    onClick={() => navigate(me.role === 'team' ? '/team' : '/join')}
                  >
                    Продолжить <ArrowRight size={14} />
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
                      ? 'ОР'
                      : 'ST'}
                </span>
                <span className="profile-name">
                  {me.role === 'team'
                    ? me.team.name
                    : me.role === 'organizer'
                      ? 'Организатор'
                      : 'Начать путь'}
                  <small>
                    {me.role === 'guest'
                      ? 'Гость пространства'
                      : me.role === 'team'
                        ? 'Моя команда'
                        : 'Управление лигой'}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  {data.demoMode && (
                    <>
                      <span className="menu-caption">ДЕМО-ПРОСТРАНСТВО</span>
                      <button onClick={() => demoLogin('team')}>
                        <Compass size={16} />
                        Демо-команда
                      </button>
                      <button onClick={() => demoLogin('organizer')}>
                        <ShieldCheck size={16} />
                        Демо-организатор
                      </button>
                    </>
                  )}
                  {me.role === 'guest' ? (
                    <button onClick={() => navigate('/join')}>
                      <ArrowRight size={16} />
                      Вступить / войти
                    </button>
                  ) : (
                    <button onClick={logout}>
                      <LogOut size={16} />
                      Выйти
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
              ? 'Демо-пространство · учебные команды и проекты, не статистика всей платформы'
              : 'Пилотный сезон · публикация подтверждается организатором вручную'}
          </span>
          <button onClick={() => setHelp(true)}>
            Как это работает <ArrowUpRight size={13} />
          </button>
        </div>
        <main className={`main page-${route.slice(1) || 'home'}`}>
          <React.Fragment key={fullRoute}>{pages[route] || <Dashboard {...ctx} />}</React.Fragment>
        </main>
        <footer className="footer">
          <span>© 2026 Startify Sprint · Команда Undefined</span>
          <span>
            AI Startify Global Growth Challenge <i /> Activation, not just registration.
          </span>
        </footer>
      </div>
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.tone === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span>{toast.message}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="Ваш путь и интеграции" onClose={() => setHelp(false)} wide>
          <div className="help-content">
            <Badge tone="green">Честный MVP · без выдуманного API</Badge>
            <h3>Идея → работа → публикация → зачёт</h3>
            <p>
              Заполняйте заметки, проверяйте гипотезы и готовьте проект. На пятом этапе отправьте ссылку на
              паспорт AI Startify. Организатор проверяет её вручную; только после этого проект попадает в
              рейтинг.
            </p>
            <h3>SmallThinker · серверный адаптер</h3>
            <p>
              Адаптер работает с OpenAI-compatible API. Рекомендуемый путь для SmallThinker — llama.cpp;
              поддержку в Ollama/vLLM проверяйте для своей версии. По умолчанию модель отключена: помощник
              возвращает явно помеченные учебные шаблоны, а не выдуманные AI-ответы.
            </p>
            <pre>
              {
                'LLM_ENABLED=true\nLLM_BASE_URL=http://127.0.0.1:8080/v1\nLLM_MODEL=smallthinker\nLLM_RESPONSE_FORMAT=none'
              }
            </pre>
            <p>
              Укажите точный ID модели вашего сервера. Ключи хранятся только на сервере. Ответы проверяются по
              JSON-схеме; применение черновика — отдельное действие команды. Полная инструкция:{' '}
              <a href="/docs/SMALLTHINKER.md" target="_blank" rel="noreferrer">
                docs/SMALLTHINKER.md ↗
              </a>
              .
            </p>
            <h3>Данные несовершеннолетних</h3>
            <p>
              Используйте nickname и учебные данные. Не добавляйте телефоны, адреса и персональные данные. Это
              пилотная технология, а не юридически завершённый сервис для массового запуска детьми.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setHelp(false);
                navigate('/strategy');
              }}
            >
              Исследование и стратегия <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
