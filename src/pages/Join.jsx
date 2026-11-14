import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  KeyRound,
  ShieldCheck,
  Copy,
  CheckCircle2,
  School,
  CalendarDays,
  Download,
} from 'lucide-react';
import { Badge, Button, Card, Field, Modal, SectionHead } from '../components/UI';
import { post, copyText, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
export default function Join({ data, refresh, navigate, notify, demoLogin }) {
  const { t, tf, te, lang, loc } = useI18n();
  const [login, setLogin] = useState(
    new URLSearchParams(window.location.hash.split('?')[1]).get('login') === '1',
  );
  const [form, setForm] = useState({
    accessCode: data.inviteHint || '',
    countryCode: 'KZ',
    schoolName: '',
    city: '',
    teamName: '',
    nickname: '',
    consent: false,
    ageConfirmed: false,
  });
  const [credentials, setCredentials] = useState(null),
    [busy, setBusy] = useState(false),
    [loginForm, setLoginForm] = useState({ teamId: '', recoveryKey: '' });
  const [challengeId, setChallengeId] = useState(data.challenge.id);
  const fromSchoolId = new URLSearchParams(window.location.search).get('from') || '';
  const school = data.schools.find((s) => s.id === fromSchoolId);
  const season = data.challenges.find((c) => c.id === challengeId) || data.challenge;
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  // One opening of an invite link = one row. The server stores a daily rotating hash, not a person.
  useEffect(() => {
    if (fromSchoolId)
      post('/api/invite/click', { schoolId: fromSchoolId, challengeId: data.challenge.id }).catch(() => {});
  }, [fromSchoolId, data.challenge.id]);
  function pickSeason(id) {
    setChallengeId(id);
    update('accessCode', id === data.challenge.id ? data.inviteHint || '' : '');
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (login) {
        await post('/api/auth/team', loginForm);
        await refresh();
        navigate('/team');
      } else {
        const r = await post('/api/teams', { ...form, fromSchoolId, challengeId });
        setCredentials(r);
        await refresh();
      }
    } catch (err) {
      notify(te(err.message), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow={t('ТВОЙ ПЕРВЫЙ ШАГ')}
        title={login ? t('С возвращением в команду') : t('Большая идея начинается с команды')}
        text={t('Без сложных анкет. Только команда, школа и желание что-то изменить.')}
      />
      <div className="join-layout">
        <Card className="join-form">
          <div className="tabs">
            <button className={!login ? 'active' : ''} onClick={() => setLogin(false)}>
              {t('Создать команду')}
            </button>
            <button className={login ? 'active' : ''} onClick={() => setLogin(true)}>
              {t('Войти по ключу')}
            </button>
          </div>
          {school && !login && (
            <div className="notice">
              <School size={18} />
              {t('Вас пригласила школа:')} <strong>{school.name}</strong>
            </div>
          )}
          <form onSubmit={submit} className="form-grid">
            {login ? (
              <>
                <Field
                  label={t('ID команды')}
                  className="full-width"
                  hint={t('Выдан при создании команды, начинается с team-')}
                >
                  <input
                    required
                    value={loginForm.teamId}
                    onChange={(e) => setLoginForm({ ...loginForm, teamId: e.target.value })}
                  />
                </Field>
                <Field label={t('Ключ восстановления')} className="full-width">
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={loginForm.recoveryKey}
                    onChange={(e) => setLoginForm({ ...loginForm, recoveryKey: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                {data.challenges.length > 1 && (
                  <Field
                    label={t('Сезон спринта')}
                    className="full-width"
                    hint={
                      season.isOpen
                        ? t('Код приглашения у каждого сезона свой.')
                        : t('Этот сезон закрыт для новых команд.')
                    }
                  >
                    <select value={challengeId} onChange={(e) => pickSeason(e.target.value)}>
                      {data.challenges.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                          {c.isOpen ? '' : t(' · закрыт')}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={t('Код приглашения')} hint={t('Получите код у учителя или организатора.')}>
                  <input
                    required
                    value={form.accessCode}
                    onChange={(e) => update('accessCode', e.target.value)}
                    placeholder={t('Код вашей школы')}
                  />
                </Field>
                <Field label={t('Страна')}>
                  <select value={form.countryCode} onChange={(e) => update('countryCode', e.target.value)}>
                    {data.countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {loc(c, 'name')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Школа')}>
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    list="school-options"
                    value={form.schoolName}
                    onChange={(e) => update('schoolName', e.target.value)}
                    placeholder={t('Название или учебный псевдоним')}
                  />
                  <datalist id="school-options">
                    {data.schools
                      .filter((s) => s.country_code === form.countryCode)
                      .map((s) => (
                        <option key={s.id} value={s.name} />
                      ))}
                  </datalist>
                </Field>
                <Field label={t('Город')}>
                  <input
                    maxLength={80}
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder={t('Например, Алматы')}
                  />
                </Field>
                <Field label={t('Название команды')}>
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    value={form.teamName}
                    onChange={(e) => update('teamName', e.target.value)}
                    placeholder={t('Например, Orbit Lab')}
                  />
                </Field>
                <Field label={t('Nickname капитана')} hint={t('Не указывайте настоящее имя.')}>
                  <input
                    required
                    maxLength={60}
                    value={form.nickname}
                    onChange={(e) => update('nickname', e.target.value)}
                    placeholder={t('Ваш псевдоним')}
                  />
                </Field>
                <label className="consent full-width">
                  <input
                    type="checkbox"
                    required
                    checked={form.ageConfirmed}
                    onChange={(e) => update('ageConfirmed', e.target.checked)}
                  />
                  <span>
                    {t(
                      'Мне 13 лет или больше. Для реального пилота получено согласие школы и законного представителя, если оно требуется.',
                    )}
                  </span>
                </label>
                <label className="consent full-width">
                  <input
                    type="checkbox"
                    required
                    checked={form.consent}
                    onChange={(e) => update('consent', e.target.checked)}
                  />
                  <span>
                    {t(
                      'Понимаю, что учебные заметки и подтверждённый проект доступны организатору, а название команды и проекта видны в лиге. Не буду добавлять персональные данные.',
                    )}
                  </span>
                </label>
              </>
            )}
            <Button className="full-width" busy={busy}>
              {login ? t('Вернуться в команду') : t('Создать команду и начать')}
              <ArrowRight size={17} />
            </Button>
          </form>
          {data.demoMode && (
            <div className="join-demo">
              <span>{t('Хочешь сначала посмотреть?')}</span>
              <button className="text-link" onClick={() => demoLogin('team')}>
                {t('Открыть демо-команду')} <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="join-demo">
            <span>
              <School size={14} /> {t('Вы ведёте класс?')}
            </span>
            <button className="text-link" onClick={() => navigate('/teacher')}>
              {t('Кабинет координатора школы')} <ArrowRight size={14} />
            </button>
          </div>
        </Card>
        <div className="join-aside">
          <span className="icon-tile lime">
            <ShieldCheck size={28} />
          </span>
          <h2>
            {t('Твоя идея —')}
            <br />
            {t('твоё пространство.')}
          </h2>
          <p>
            {t(
              'Мы не просим настоящее имя, email или телефон. Команда получает секретный ключ для возвращения.',
            )}
          </p>
          <ul>
            <li>
              <CheckCircle2 size={17} />
              {t('Заметки видны только вашей команде и организатору.')}
            </li>
            <li>
              <CheckCircle2 size={17} />
              {t('AI-черновик применяется только с вашего согласия.')}
            </li>
            <li>
              <CheckCircle2 size={17} />
              {t('Публикация проверяется человеком.')}
            </li>
          </ul>
          <small>
            {t('Демо хранит данные в SQLite на этом сервере. Не используйте конфиденциальную информацию.')}
          </small>
        </div>
      </div>
      {credentials && (
        <Modal
          title={t('Команда создана. Сохраните ключ!')}
          onClose={() => {
            if (
              window.confirm(
                t(
                  'Ключ показывается только один раз. Вы сохранили его? Без ключа вход в команду невозможно восстановить.',
                ),
              )
            )
              navigate('/team');
          }}
        >
          <div className="notice warning">
            {t('Ключ показывается один раз. Без него нельзя восстановить вход.')}{' '}
            {data.demoMode
              ? t('Это демо: не используйте ключ от других сервисов.')
              : t('Храните ключ отдельно от общего школьного компьютера.')}
          </div>
          <Field label={t('ID команды')}>
            <input readOnly value={credentials.teamId} onFocus={(e) => e.target.select()} />
          </Field>
          <Field label={t('Ключ восстановления')}>
            <input readOnly value={credentials.recoveryKey} onFocus={(e) => e.target.select()} />
          </Field>
          <div className="modal-actions">
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await copyText(
                  tf('ID: {id}\nКлюч: {key}', { id: credentials.teamId, key: credentials.recoveryKey }),
                );
                notify(
                  ok ? t('Ключ скопирован. Храните его приватно.') : t('Скопируйте поля вручную.'),
                  ok ? 'success' : 'error',
                );
              }}
            >
              <Copy size={16} />
              {t('Скопировать')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                downloadFile(
                  'startify-recovery.txt',
                  tf(
                    'Startify Sprint — ключ восстановления\nID: {id}\nКлюч: {key}\n\nХраните приватно. Не отправляйте в общий чат.',
                    {
                      id: credentials.teamId,
                      key: credentials.recoveryKey,
                    },
                  ),
                )
              }
            >
              <Download size={16} />
              {t('Сохранить ключ')}
            </Button>
            <Button onClick={() => navigate('/team')}>
              {t('К первой идее')} <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
