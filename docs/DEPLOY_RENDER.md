# Быстрый деплой демо для жюри на Render

Цель: получить одну публичную HTTPS-ссылку на Startify Sprint без ручной настройки сервера. Это **демо-стенд**: `DEMO_MODE=true`, `SEED_DEMO=true`, SmallThinker выключена, ответы наставника помечены как шаблоны.

## Почему Render

Приложение — один долгоживущий Node/Express-процесс с файловой SQLite. Render умеет собирать наш `Dockerfile` и подключать persistent disk к `/app/data`, поэтому команды, заявки и лига переживают перезапуск. Vercel/статический хостинг для этой архитектуры не подходят; бесплатный Render без диска теряет SQLite при перезапуске и засыпает, поэтому для спокойной ссылки жюри выбран платный минимальный инстанс.

Ориентир по цене на ноябрь 2026: workspace Hobby — $0/мес, минимальный платный web-инстанс — $7/мес, persistent disk — $0.25/GB/мес; в blueprint выбран 1 GB. Проверяйте итог в корзине Render перед подтверждением: тарифы и налоги могут меняться.

## Один маршрут

1. Откройте кнопку деплоя из README или ссылку:
   <https://render.com/deploy?repo=https://github.com/b1-o/Symbat-hackaton-team-Undefined-repo>
2. Войдите через GitHub и разрешите Render доступ к репозиторию. Для приватного репозитория установите GitHub App Render, если он попросит.
3. Выберите workspace **Hobby**, branch **main**, Blueprint path **render.yaml**.
4. Проверьте, что создаются **один web service** `startify-sprint` и **один disk** `startify-data`; не добавляйте Postgres, Redis или второй сервис.
5. Подтвердите платный минимальный инстанс и нажмите **Apply / Deploy**.
6. Дождитесь статуса **Live**, откройте URL вида `https://startify-sprint-xxxx.onrender.com` и проверьте `GET /api/health`.
7. В интерфейсе проверьте демо-вход команды, координатора и организатора. Эту ссылку можно передавать жюри.

Если кнопка не открылась: в Render Dashboard нажмите **New → Blueprint**, подключите этот репозиторий, выберите `main` и файл `render.yaml`.

## Что уже задано в blueprint

- Docker-сборка из корня репозитория, health check `/api/health`;
- один инстанс, Франкфурт, `PORT` подставляет Render, сервер слушает `0.0.0.0`;
- SQLite: `DB_PATH=/app/data/startify.db`, диск смонтирован в `/app/data`;
- `DEMO_MODE=true`, `SEED_DEMO=true`, `LLM_ENABLED=false`;
- `COOKIE_SECURE=true`, `TRUST_PROXY=1`;
- автодеплой выключен, чтобы случайный push не менял стенд во время защиты. Обновление — **Manual Deploy** в Render.

## Границы и завершение

- Это демо с помеченными данными, не реальный школьный пилот и не production-сервис для детей.
- Persistent disk рассчитан на один инстанс; не включайте горизонтальное масштабирование.
- SmallThinker не разворачивается этим blueprint: для неё нужен отдельный сервер по [SMALLTHINKER.md](SMALLTHINKER.md).
- Перед реальным пилотом: `DEMO_MODE=false`, `SEED_DEMO=false`, приватные `ORGANIZER_PASSWORD` и `CHALLENGE_ACCESS_CODE`, отдельный путь БД, backup и юридическая готовность по [OPERATIONS.md](OPERATIONS.md).
- Если ссылка после защиты больше не нужна, сначала сохраните нужные данные/backup, затем удалите сервис и диск в Render, чтобы остановить начисления.
