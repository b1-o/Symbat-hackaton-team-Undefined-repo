import React, { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, ExternalLink, ShieldCheck, Rocket } from 'lucide-react';
import { Badge, Button, Card, Empty, Field, Modal, SectionHead } from '../components/UI';
import { ProjectCard } from './Dashboard';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function Showcase({ data, navigate }) {
  const { t, tf, te, lang, loc } = useI18n();
  const initialQuery = () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '';
  const initial = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const [query, setQuery] = useState(initialQuery),
    [country, setCountry] = useState('all'),
    [category, setCategory] = useState('all'),
    [selected, setSelected] = useState(null);
  const [projects, setProjects] = useState(data.projects),
    [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const onHash = () => setQuery(initialQuery());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setLoadError('');
      const params = new URLSearchParams({
        q: query,
        challenge: data.challenge.id,
        limit: '24',
        ...(country !== 'all' ? { country } : {}),
        ...(category !== 'all' ? { category } : {}),
      });
      api(`/api/projects?${params}`, { signal: controller.signal })
        .then((r) => {
          setProjects(r.projects);
          setNext(r.page.nextOffset);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setLoadError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, country, category, reload, data.challenge.id]);
  async function loadMore() {
    const current = generation.current;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({
        q: query,
        challenge: data.challenge.id,
        limit: '24',
        offset: String(next),
        ...(country !== 'all' ? { country } : {}),
        ...(category !== 'all' ? { category } : {}),
      });
      const r = await api(`/api/projects?${params}`);
      if (current !== generation.current) return;
      setProjects((p) => [...p, ...r.projects.filter((item) => !p.some((old) => old.id === item.id))]);
      setNext(r.page.nextOffset);
    } catch (e) {
      if (current === generation.current) setLoadError(e.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow={t('ВИТРИНА СТАРТАПОВ')}
        title={t('Идеи, которые уже на орбите')}
        text={t('Не просто красивые питчи. Проекты, прошедшие путь до публикации и ручной проверки.')}
      >
        <Badge tone="green">
          <ShieldCheck size={14} /> {t('Проверено организатором')}
        </Badge>
      </SectionHead>
      <Card className="filter-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            aria-label={t('Поиск проектов')}
            placeholder={t('Название, идея или команда…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Field label={t('Страна')}>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">{t('Все страны')}</option>
            {data.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Направление')}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">{t('Все направления')}</option>
            {data.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </Card>
      <div className="results-line">
        <span>
          <SlidersHorizontal size={14} />{' '}
          {loading
            ? t('Ищем проекты…')
            : tf('Показано проектов: {count}', { count: `${projects.length}${next !== null ? '+' : ''}` })}
        </span>
        {(query || country !== 'all' || category !== 'all') && (
          <button
            className="text-link"
            onClick={() => {
              setQuery('');
              setCountry('all');
              setCategory('all');
            }}
          >
            {t('Сбросить фильтры')}
          </button>
        )}
      </div>
      <div className="project-grid showcase-grid">
        {projects.map((p) => (
          <div key={p.id}>
            <ProjectCard project={p} navigate={() => setSelected(p)} />
          </div>
        ))}
      </div>
      {loadError && (
        <div className="notice warning" role="alert">
          {loadError}{' '}
          <button className="text-link" onClick={() => setReload((v) => v + 1)}>
            {t('Повторить')}
          </button>
        </div>
      )}
      {next !== null && (
        <div className="load-more">
          <Button variant="ghost" busy={loading} onClick={loadMore}>
            {t('Показать ещё проекты')}
          </Button>
        </div>
      )}
      {!loading && !projects.length && (
        <Empty
          title={t('Пока ничего не найдено')}
          text={t('Измените фильтры или станьте автором следующего проекта.')}
        >
          <Button onClick={() => navigate('/join')}>
            {t('Начать свой проект')} <Rocket size={16} />
          </Button>
        </Empty>
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <div className="project-detail">
            <div className="badges">
              <Badge tone="purple">{selected.category}</Badge>
              {selected.is_demo && <Badge>{t('Демо-пример')}</Badge>}
              <Badge tone="green">{t('Подтверждён')}</Badge>
            </div>
            <p>{selected.description}</p>
            <dl>
              <dt>{t('Команда')}</dt>
              <dd>{selected.team_name}</dd>
              <dt>{t('Школа')}</dt>
              <dd>{selected.school_name}</dd>
              <dt>{t('Страна')}</dt>
              <dd>{t(selected.countryName)}</dd>
            </dl>
            {selected.is_demo ? (
              <div className="notice">
                {t(
                  'Это учебный пример интерфейса, не реальный паспорт AI Startify. Ссылка на несуществующий проект не выдаётся за настоящую.',
                )}
              </div>
            ) : (
              <a className="btn primary" href={selected.url} target="_blank" rel="noopener noreferrer">
                {t('Паспорт в AI Startify')} <ExternalLink size={16} />
              </a>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
