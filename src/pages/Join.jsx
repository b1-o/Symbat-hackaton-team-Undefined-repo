import React, { useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck, Copy, CheckCircle2, School, Download } from 'lucide-react';
import { Badge, Button, Card, Field, Modal, SectionHead } from '../components/UI';
import { post, copyText, downloadFile } from '../lib/api';
export default function Join({ data, refresh, navigate, notify, demoLogin }) {
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
  const fromSchoolId = new URLSearchParams(window.location.search).get('from') || '';
  const school = data.schools.find((s) => s.id === fromSchoolId);
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (login) {
        await post('/api/auth/team', loginForm);
        await refresh();
        navigate('/team');
      } else {
        const r = await post('/api/teams', { ...form, fromSchoolId });
        setCredentials(r);
        await refresh();
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="ТВОЙ ПЕРВЫЙ ШАГ"
        title={login ? 'С возвращением в команду' : 'Большая идея начинается с команды'}
        text="Без сложных анкет. Только команда, школа и желание что-то изменить."
      />
      <div className="join-layout">
        <Card className="join-form">
          <div className="tabs">
            <button className={!login ? 'active' : ''} onClick={() => setLogin(false)}>
              Создать команду
            </button>
            <button className={login ? 'active' : ''} onClick={() => setLogin(true)}>
              Войти по ключу
            </button>
          </div>
          {school && !login && (
            <div className="notice">
              <School size={18} />
              Вас пригласила школа: <strong>{school.name}</strong>
            </div>
          )}
          <form onSubmit={submit} className="form-grid">
            {login ? (
              <>
                <Field
                  label="ID команды"
                  className="full-width"
                  hint="Выдан при создании команды, начинается с team-"
                >
                  <input
                    required
                    value={loginForm.teamId}
                    onChange={(e) => setLoginForm({ ...loginForm, teamId: e.target.value })}
                  />
                </Field>
                <Field label="Ключ восстановления" className="full-width">
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
                <Field label="Код приглашения" hint="Получите код у учителя или организатора.">
                  <input
                    required
                    value={form.accessCode}
                    onChange={(e) => update('accessCode', e.target.value)}
                    placeholder="Код вашей школы"
                  />
                </Field>
                <Field label="Страна">
                  <select value={form.countryCode} onChange={(e) => update('countryCode', e.target.value)}>
                    {data.countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Школа">
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    list="school-options"
                    value={form.schoolName}
                    onChange={(e) => update('schoolName', e.target.value)}
                    placeholder="Название или учебный псевдоним"
                  />
                  <datalist id="school-options">
                    {data.schools
                      .filter((s) => s.country_code === form.countryCode)
                      .map((s) => (
                        <option key={s.id} value={s.name} />
                      ))}
                  </datalist>
                </Field>
                <Field label="Город">
                  <input
                    maxLength={80}
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder="Например, Алматы"
                  />
                </Field>
                <Field label="Название команды">
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    value={form.teamName}
                    onChange={(e) => update('teamName', e.target.value)}
                    placeholder="Например, Orbit Lab"
                  />
                </Field>
                <Field label="Nickname капитана" hint="Не указывайте настоящее имя.">
                  <input
                    required
                    maxLength={60}
                    value={form.nickname}
                    onChange={(e) => update('nickname', e.target.value)}
                    placeholder="Ваш псевдоним"
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
                    Мне 13 лет или больше. Для реального пилота получено согласие школы и законного
                    представителя, если оно требуется.
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
                    Понимаю, что учебные заметки и подтверждённый проект доступны организатору, а название
                    команды и проекта видны в лиге. Не буду добавлять персональные данные.
                  </span>
                </label>
              </>
            )}
            <Button className="full-width" busy={busy}>
              {login ? 'Вернуться в команду' : 'Создать команду и начать'}
              <ArrowRight size={17} />
            </Button>
          </form>
          {data.demoMode && (
            <div className="join-demo">
              <span>Хочешь сначала посмотреть?</span>
              <button className="text-link" onClick={() => demoLogin('team')}>
                Открыть демо-команду <ArrowRight size={14} />
              </button>
            </div>
          )}
        </Card>
        <div className="join-aside">
          <span className="icon-tile lime">
            <ShieldCheck size={28} />
          </span>
          <h2>
            Твоя идея —<br />
            твоё пространство.
          </h2>
          <p>
            Мы не просим настоящее имя, email или телефон. Команда получает секретный ключ для возвращения.
          </p>
          <ul>
            <li>
              <CheckCircle2 size={17} />
              Заметки видны только вашей команде и организатору.
            </li>
            <li>
              <CheckCircle2 size={17} />
              AI-черновик применяется только с вашего согласия.
            </li>
            <li>
              <CheckCircle2 size={17} />
              Публикация проверяется человеком.
            </li>
          </ul>
          <small>
            Демо хранит данные в SQLite на этом сервере. Не используйте конфиденциальную информацию.
          </small>
        </div>
      </div>
      {credentials && (
        <Modal
          title="Команда создана. Сохраните ключ!"
          onClose={() => {
            if (
              window.confirm(
                'Ключ показывается только один раз. Вы сохранили его? Без ключа вход в команду невозможно восстановить.',
              )
            )
              navigate('/team');
          }}
        >
          <div className="notice warning">
            Ключ показывается один раз. Без него нельзя восстановить вход.{' '}
            {data.demoMode
              ? 'Это демо: не используйте ключ от других сервисов.'
              : 'Храните ключ отдельно от общего школьного компьютера.'}
          </div>
          <Field label="ID команды">
            <input readOnly value={credentials.teamId} onFocus={(e) => e.target.select()} />
          </Field>
          <Field label="Ключ восстановления">
            <input readOnly value={credentials.recoveryKey} onFocus={(e) => e.target.select()} />
          </Field>
          <div className="modal-actions">
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await copyText(`ID: ${credentials.teamId}\nКлюч: ${credentials.recoveryKey}`);
                notify(
                  ok ? 'Ключ скопирован. Храните его приватно.' : 'Скопируйте поля вручную.',
                  ok ? 'success' : 'error',
                );
              }}
            >
              <Copy size={16} />
              Скопировать
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                downloadFile(
                  'startify-recovery.txt',
                  `Startify Sprint — ключ восстановления\nID: ${credentials.teamId}\nКлюч: ${credentials.recoveryKey}\n\nХраните приватно. Не отправляйте в общий чат.`,
                )
              }
            >
              <Download size={16} />
              Сохранить ключ
            </Button>
            <Button onClick={() => navigate('/team')}>
              К первой идее <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
