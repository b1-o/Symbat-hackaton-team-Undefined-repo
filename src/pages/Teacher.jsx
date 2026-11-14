import React, { useCallback, useEffect, useState } from 'react';
import {
  School,
  Users,
  Rocket,
  CheckCircle2,
  Send,
  BellRing,
  Copy,
  Link2,
  KeyRound,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  TriangleAlert,
  Trophy,
  MailCheck,
  Clock3,
} from 'lucide-react';
import { Badge, Button, Card, Empty, Field, Modal, Progress, SectionHead, Status } from '../components/UI';
import { api, post, copyText, inviteLink, formatDate, number } from '../lib/api';

export default function Teacher({ data, me, refresh, navigate, notify, demoLogin }) {
  const [cabinet, setCabinet] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [form, setForm] = useState({ schoolId: '', coordinatorKey: '' }),
    [reminder, setReminder] = useState(null),
    [message, setMessage] = useState(''),
    [keyModal, setKeyModal] = useState(null);
  const load = useCallback(async () => {
    if (me.role !== 'teacher') return;
    try {
      setCabinet(await api('/api/teacher'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [me.role]);
  useEffect(() => {
    load();
  }, [load]);

  async function login(e) {
    e.preventDefault();
    setBusy('login');
    try {
      await post('/api/auth/teacher', form);
      await refresh();
      setForm({ schoolId: '', coordinatorKey: '' });
      notify('Кабинет школы открыт.');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function sendReminder(e) {
    e.preventDefault();
    setBusy('remind');
    try {
      const result = await post('/api/teacher/reminders', { teamId: reminder.id, message });
      setCabinet(result);
      setReminder(null);
      setMessage('');
      notify('Напоминание отправлено в инкубатор команды.');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function rotateKey() {
    if (
      !window.confirm(
        'Старый ключ перестанет работать, все другие входы координатора будут закрыты. Продолжить?',
      )
    )
      return;
    setBusy('key');
    try {
      setKeyModal(await post('/api/teacher/rotate-key', {}));
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function shareInvite(targetSchoolId) {
    const link = inviteLink(targetSchoolId);
    if (await copyText(link))
      notify(
        targetSchoolId === me.school?.id
          ? 'Ссылка для ваших команд скопирована.'
          : 'Ссылка-вызов скопирована. Отправьте её другой школе.',
      );
    else setKeyModal({ inviteLink: link });
  }

  if (me.role !== 'teacher')
    return (
      <>
        <SectionHead
          eyebrow="ДЛЯ ТЕХ, КТО ВЕДЁТ КЛАСС"
          title="Кабинет координатора школы"
          text="Один экран вместо чата и таблиц: кто застрял, кому напомнить и сколько проектов дошло до публикации."
        />
        <div className="join-layout">
          <Card className="auth-card">
            <span className="icon-tile blue">
              <School size={30} />
            </span>
            <h2>Вход для учителя</h2>
            <p className="muted">
              ID школы и ключ координатора выдаёт организатор спринта. Один ключ — одна школа.
            </p>
            <form onSubmit={login}>
              <Field label="ID школы" hint="Начинается с school-. Организатор видит его в списке школ.">
                <input
                  required
                  value={form.schoolId}
                  onChange={(e) => setForm({ ...form, schoolId: e.target.value })}
                  placeholder="school-..."
                />
              </Field>
              <Field label="Ключ координатора">
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={form.coordinatorKey}
                  onChange={(e) => setForm({ ...form, coordinatorKey: e.target.value })}
                />
              </Field>
              <Button busy={busy === 'login'}>
                Открыть кабинет <ArrowRight size={16} />
              </Button>
            </form>
            {data.demoMode && (
              <Button variant="ghost" onClick={() => demoLogin('teacher')}>
                Посмотреть демо-кабинет школы
              </Button>
            )}
          </Card>
          <div className="join-aside">
            <span className="icon-tile lime">
              <ShieldCheck size={28} />
            </span>
            <h2>
              Помогать вовремя,
              <br />
              не проверяя тетради.
            </h2>
            <p>
              Координатор видит прогресс и статусы, но не личные заметки учеников. Содержание работ
              открывается только организатору при ручной проверке публикации.
            </p>
            <ul>
              <li>
                <CheckCircle2 size={17} />
                Список «кому помочь» строится по реальным событиям.
              </li>
              <li>
                <CheckCircle2 size={17} />
                Напоминание приходит внутри инкубатора, без email и телефонов.
              </li>
              <li>
                <CheckCircle2 size={17} />
                Видно, прочитала ли команда напоминание.
              </li>
            </ul>
            <small>
              Роль координатора — часть механики удержания: она превращает регистрацию класса в доведённые до
              публикации проекты.
            </small>
          </div>
        </div>
      </>
    );

  if (!cabinet)
    return (
      <Card>
        {error ? (
          <div className="notice warning">
            {error}{' '}
            <button className="text-link" onClick={load}>
              Повторить
            </button>
          </div>
        ) : (
          'Загружаем кабинет школы…'
        )}
      </Card>
    );
  const { school, funnel, attention, teams, invites, reminders, rank, schools } = cabinet;
  return (
    <>
      <SectionHead
        eyebrow={`КООРДИНАТОР ШКОЛЫ · ${school.countryName.toUpperCase()}`}
        title={school.name}
        text={`${school.city || 'Город не указан'} · кабинет показывает прогресс команд вашей школы в текущем сезоне.`}
      >
        <Button variant="ghost" busy={!!busy && !cabinet} onClick={load}>
          <RefreshCw size={16} />
          Обновить
        </Button>
        <Button onClick={() => navigate('/challenge')}>
          Лига школ <Trophy size={16} />
        </Button>
      </SectionHead>
      {school.is_demo && (
        <div className="notice warning">
          <TriangleAlert size={18} />
          Это демо-школа с вымышленными командами. Так кабинет выглядит у реального координатора пилота.
        </div>
      )}
      {error && <div className="notice warning">{error}</div>}
      <div className="funnel-grid">
        {[
          [Users, 'Команд школы', funnel.total, 'создано в сезоне'],
          [
            Rocket,
            'Начали работу',
            funnel.started,
            `${funnel.total ? Math.round((funnel.started / funnel.total) * 100) : 0}% от созданных`,
          ],
          [Send, 'Отправили паспорт', funnel.submitted, `${funnel.pending} на проверке`],
          [CheckCircle2, 'Подтверждено', funnel.approved, `${funnel.conversion}% дошли до зачёта`],
        ].map(([Icon, label, value, hint], i) => (
          <Card className="funnel-stat" key={label}>
            <span className={`icon-tile ${['purple', 'blue', 'orange', 'green'][i]}`}>
              <Icon size={19} />
            </span>
            <small>{label}</small>
            <strong>{value}</strong>
            <div className="funnel-bar">
              <span style={{ width: `${funnel.total ? (value / funnel.total) * 100 : 0}%` }} />
            </div>
            <span>{hint}</span>
          </Card>
        ))}
      </div>
      <div className="teacher-grid">
        <Card className="attention-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">ГДЕ НУЖЕН УЧИТЕЛЬ</span>
              <h2>Кому помочь сегодня</h2>
            </div>
            <Badge tone={attention.length ? 'amber' : 'green'}>{attention.length} требуют внимания</Badge>
          </div>
          <p className="muted">
            Причины считаются по событиям команды: возврат проекта, готовность к публикации, отсутствие старта
            и пауза в работе.
          </p>
          {!attention.length && (
            <Empty
              title="Все команды в движении"
              text="Ни одна команда школы не застряла. Можно звать другую школу в спринт."
            />
          )}
          {attention.map((team) => (
            <article className="attention-row" key={team.id}>
              <div>
                <strong>{team.name}</strong>
                <small className="table-sub">
                  {team.nickname} · {team.stepsCompleted}/5 этапов
                </small>
              </div>
              <Badge tone={team.reason.tone}>{team.reason.label}</Badge>
              <div className="attention-actions">
                {team.unreadReminders > 0 && (
                  <span className="muted small">
                    <MailCheck size={13} />
                    {team.unreadReminders} не прочитано
                  </span>
                )}
                <Button
                  variant="ghost"
                  className="tiny"
                  disabled={team.unreadReminders >= 3}
                  onClick={() => {
                    setReminder(team);
                    setMessage(team.reason.code === 'ready' ? data.steps[4].prompt : '');
                  }}
                >
                  <BellRing size={14} />
                  Напомнить
                </Button>
              </div>
            </article>
          ))}
        </Card>
        <Card className="invite-card">
          <span className="icon-tile lime">
            <Link2 size={23} />
          </span>
          <h2>Пригласить и бросить вызов</h2>
          <p className="muted">
            Ссылка сохраняет вашу школу как источник приглашения. Считаем открытия ссылки, а не людей.
          </p>
          <dl className="invite-stats">
            <dt>Открытий ссылки</dt>
            <dd>{number(invites.clicks)}</dd>
            <dt>Уникальных за день</dt>
            <dd>{number(invites.visitors)}</dd>
            <dt>Команд по приглашению</dt>
            <dd>{number(invites.teamsFromInvite)}</dd>
            <dt>Место в лиге</dt>
            <dd>{rank ? `#${rank.rank}` : 'ещё нет'}</dd>
          </dl>
          <Button variant="ghost" onClick={() => shareInvite(school.id)}>
            <Copy size={16} />
            Ссылка для моих команд
          </Button>
          <div className="rivals">
            <span className="eyebrow">КОМУ БРОСИТЬ ВЫЗОВ</span>
            {!schools.length && <p className="muted small">Других школ пока нет — станьте первой.</p>}
            {schools.map((other) => (
              <button key={other.id} onClick={() => shareInvite(school.id)}>
                <span>
                  {other.name}
                  <small>
                    {other.countryName} · {other.verified} зачётов{other.isDemo ? ' · демо' : ''}
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <div>
            <h2>Команды школы</h2>
            <p className="muted small">
              Заметки учеников скрыты. Координатор видит только прогресс, статус и активность.
            </p>
          </div>
          <Badge tone="neutral">
            {reminders.sent} напоминаний · {reminders.unread} не прочитано
          </Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Команда</th>
                <th>Прогресс</th>
                <th>Статус</th>
                <th>Активность</th>
                <th>Напоминания</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <strong>{team.name}</strong>
                    <small className="table-sub">
                      {team.nickname} · с {formatDate(team.createdAt)}
                    </small>
                  </td>
                  <td className="progress-cell">
                    <Progress value={team.stepsCompleted * 20} label={`Прогресс ${team.name}`} />
                    <small>{team.stepsCompleted}/5</small>
                  </td>
                  <td>
                    <Status submission={team.submissionStatus ? { status: team.submissionStatus } : null} />
                  </td>
                  <td>
                    <span className="muted small">
                      <Clock3 size={13} />
                      {team.idleHours === null
                        ? 'не начинали'
                        : team.idleHours < 24
                          ? 'сегодня'
                          : `${Math.floor(team.idleHours / 24)} дн. назад`}
                    </span>
                  </td>
                  <td>
                    {team.remindersSent ? (
                      <span className="muted small">
                        {team.remindersSent} отправлено
                        {team.unreadReminders ? ` · ${team.unreadReminders} новых` : ' · прочитано'}
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn tiny ghost"
                      disabled={team.unreadReminders >= 3}
                      onClick={() => {
                        setReminder(team);
                        setMessage('');
                      }}
                    >
                      <BellRing size={14} />
                      Напомнить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!teams.length && (
          <Empty
            title="В школе пока нет команд"
            text="Отправьте ссылку классу: команда создаётся за минуту по коду приглашения."
          >
            <Button onClick={() => shareInvite(school.id)}>
              Скопировать ссылку <Copy size={15} />
            </Button>
          </Empty>
        )}
      </Card>
      <div className="organizer-bottom">
        <Card>
          <div className="card-heading">
            <h2>Доступ координатора</h2>
            <Badge tone={school.hasCoordinatorKey ? 'green' : 'amber'} dot>
              {school.hasCoordinatorKey ? 'Ключ выдан' : 'Только демо-вход'}
            </Badge>
          </div>
          <p className="muted">
            ID школы: <code>{school.id}</code>. Передайте его вместе с ключом тому, кто ведёт класс. Ключ
            хранится на сервере только в виде хеша.
          </p>
          <Button variant="ghost" busy={busy === 'key'} onClick={rotateKey}>
            <KeyRound size={16} />
            Выдать новый ключ
          </Button>
          <small className="muted">Ротация закрывает все прежние сессии координатора этой школы.</small>
        </Card>
        <Card>
          <div className="card-heading">
            <h2>Что делает координатор</h2>
            <Badge tone="purple">Механика удержания</Badge>
          </div>
          <ol className="teacher-playbook">
            <li>
              <strong>День 1.</strong> Раздать ссылку и код, собрать команды по 2–3 человека.
            </li>
            <li>
              <strong>День 2–3.</strong> Проверить список «кому помочь»: интервью обычно и есть узкое место.
            </li>
            <li>
              <strong>День 4–5.</strong> Напомнить командам с четырьмя этапами опубликовать паспорт.
            </li>
            <li>
              <strong>День 6–7.</strong> Разобрать возвраты и бросить вызов соседней школе.
            </li>
          </ol>
          <Button variant="ghost" onClick={() => navigate('/strategy')}>
            Как это влияет на воронку <ArrowRight size={15} />
          </Button>
        </Card>
      </div>
      {reminder && (
        <Modal title={`Напоминание команде ${reminder.name}`} onClose={() => setReminder(null)}>
          <p className="muted">
            Команда увидит его в своём инкубаторе. Без email, телефонов и персональных данных.
          </p>
          <div className="preset-list">
            {reminders.presets.map((preset) => (
              <button key={preset} className="preset" onClick={() => setMessage(preset)}>
                {preset}
              </button>
            ))}
          </div>
          <form onSubmit={sendReminder}>
            <Field
              label="Текст напоминания"
              hint={`${message.length}/400 символов. Не более трёх непрочитанных у одной команды.`}
            >
              <textarea
                required
                rows={3}
                minLength={5}
                maxLength={400}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Один конкретный следующий шаг…"
              />
            </Field>
            <div className="modal-actions">
              <Button variant="ghost" type="button" onClick={() => setReminder(null)}>
                Отмена
              </Button>
              <Button busy={busy === 'remind'} disabled={message.trim().length < 5}>
                Отправить <Send size={15} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {keyModal && (
        <Modal
          title={keyModal.inviteLink ? 'Ссылка приглашения' : 'Новый ключ координатора'}
          onClose={() => setKeyModal(null)}
        >
          {keyModal.inviteLink ? (
            <>
              <p>Скопируйте ссылку вручную:</p>
              <input readOnly value={keyModal.inviteLink} onFocus={(e) => e.target.select()} />
            </>
          ) : (
            <>
              <div className="notice warning">Ключ показывается один раз. Прежний ключ уже не работает.</div>
              <Field label="ID школы">
                <input readOnly value={keyModal.schoolId} onFocus={(e) => e.target.select()} />
              </Field>
              <Field label="Ключ координатора">
                <input readOnly value={keyModal.coordinatorKey} onFocus={(e) => e.target.select()} />
              </Field>
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await copyText(`Школа: ${keyModal.schoolId}\nКлюч: ${keyModal.coordinatorKey}`);
                  notify(
                    ok ? 'Скопировано. Передайте координатору приватно.' : 'Скопируйте поля вручную.',
                    ok ? 'success' : 'error',
                  );
                }}
              >
                <Copy size={16} />
                Скопировать
              </Button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
