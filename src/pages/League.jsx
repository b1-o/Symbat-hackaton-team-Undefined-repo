import React, { useState } from 'react';
import {
  Trophy,
  Copy,
  ArrowRight,
  Globe2,
  School,
  Users,
  ShieldCheck,
  Link2,
  Gift,
  CheckCircle2,
} from 'lucide-react';
import { Badge, Button, Card, Empty, Modal, SectionHead } from '../components/UI';
import { copyText, inviteLink } from '../lib/api';
import { useI18n } from '../lib/i18n';
export default function League({ data, me, navigate, notify }) {
  const { t, tf, te, lang, loc } = useI18n();
  const [tab, setTab] = useState('schools'),
    [country, setCountry] = useState('all'),
    [invite, setInvite] = useState(null);
  const rows = data.leaderboard.schools.filter((s) => country === 'all' || s.country_code === country);
  async function challenge(schoolId) {
    const link = inviteLink(schoolId);
    if (await copyText(link)) notify(t('Ссылка-вызов скопирована. Отправьте её другой школе.'));
    else setInvite(link);
  }
  return (
    <>
      <SectionHead
        eyebrow={t('ШКОЛЬНАЯ ЛИГА · СЕЗОН 2026')}
        title={t('Твоя школа. Твоя команда. Ваш момент.')}
        text={t(
          'Семь дней, чтобы решить знакомую проблему. В рейтинге считаются подтверждённые проекты, а не регистрации.',
        )}
      >
        <Button onClick={() => navigate(me.role === 'team' ? '/team' : '/join')}>
          {me.role === 'team' ? t('Моя команда') : t('Вступить в лигу')}
          <ArrowRight size={16} />
        </Button>
      </SectionHead>
      <div className="league-banner">
        <div>
          <Badge tone="lime">{t('ГЛАВНЫЙ ЧЕЛЛЕНДЖ')}</Badge>
          <h2>
            {t('Проблема моей школы →')}
            <br />
            {t('стартап за 7 дней')}
          </h2>
          <p>
            {t('Пригласи школу-соперника. Обе школы получат больше идей,')}
            <br />
            {t('а лучшие команды — обратную связь и портфолио.')}
          </p>
        </div>
        <div className="league-trophy">
          <Trophy size={90} strokeWidth={1.2} />
        </div>
        <div className="league-rules">
          <span>
            <Users size={18} /> {t('1–4 участника')}
          </span>
          <span>
            <Globe2 size={18} /> {t('5 стран пилота')}
          </span>
          <span>
            <ShieldCheck size={18} /> {t('Ручная проверка')}
          </span>
        </div>
      </div>
      <div className="league-mechanics">
        {[
          [Link2, '01', t('Соберите команду'), t('Код школы, nickname и одна проблема.')],
          [CheckCircle2, '02', t('Пройдите 5 этапов'), t('Заметки, интервью, решение и питч.')],
          [Gift, '03', t('Получите признание'), t('Публикация, портфолио и место школы в лиге.')],
        ].map(([Icon, n, title, text]) => (
          <Card key={n}>
            <span className="eyebrow">{tf('ШАГ {n}', { n })}</span>
            <Icon size={24} />
            <h3>{title}</h3>
            <p>{text}</p>
          </Card>
        ))}
      </div>
      <div className="section-title">
        <h2>{t('Рейтинг честных результатов')}</h2>
        <select
          aria-label={t('Страна рейтинга')}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="all">{t('Все страны')}</option>
          {data.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {loc(c, 'name')}
            </option>
          ))}
        </select>
      </div>
      <div className="tabs" role="tablist">
        {[
          ['schools', t('Школы'), School],
          ['countries', t('Страны'), Globe2],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <Card className="table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Место')}</th>
                <th>{tab === 'schools' ? t('Школа') : t('Страна')}</th>
                <th>{tab === 'schools' ? t('Страна') : t('Школы')}</th>
                <th>{t('Команды')}</th>
                <th>{t('Подтверждено')}</th>
                <th>{t('Вызов')}</th>
              </tr>
            </thead>
            <tbody>
              {(tab === 'schools' ? rows : data.leaderboard.countries).map((row, i) => (
                <tr key={row.id || row.country_code}>
                  <td>
                    <span className={`rank rank-${i}`}>{i === 0 ? <Trophy size={15} /> : i + 1}</span>
                  </td>
                  <td>
                    <strong>{row.name || `${row.flag} ${t(row.countryName)}`}</strong>
                    {row.isDemo && <Badge>{t('Демо')}</Badge>}
                    <small className="table-sub">{row.city || t('Международный пилот')}</small>
                  </td>
                  <td>{row.countryName || row.schools}</td>
                  <td>{row.teams}</td>
                  <td>
                    <strong className="green-text">{row.verified}</strong>
                  </td>
                  <td>
                    {tab === 'schools' ? (
                      <button className="btn tiny ghost" onClick={() => challenge(row.id)}>
                        <Copy size={14} />
                        {t('Вызов')}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && tab === 'schools' && (
          <Empty
            title={t('Эта страна ещё не на орбите')}
            text={t('Пригласите первую школу — и откройте новый сезон.')}
          />
        )}
      </Card>
      <div className="notice">
        <ShieldCheck size={18} />
        {t(
          'Один паспорт = один зачёт. Повторная отправка тем же или другим составом не увеличивает рейтинг. Атрибуция приглашения сохраняется при создании приглашённой команды.',
        )}
      </div>
      {invite && (
        <Modal title={t('Ссылка-вызов')} onClose={() => setInvite(null)}>
          <p>{t('Скопируйте ссылку вручную:')}</p>
          <input readOnly value={invite} onFocus={(e) => e.target.select()} />
        </Modal>
      )}
    </>
  );
}
