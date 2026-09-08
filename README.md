# 🎃 Sport Quest — трекер «Операция „Анти-плед“»

Онлайн-трекер осеннего спортивного квеста: участники записывают активности и задания бинго,
приложение само считает тыковки, стрики и таблицу лидеров. Спецификация — в [SPEC.md](SPEC.md).

## Стек
Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind v4 · Prisma 7 · PostgreSQL (Docker) · Vitest.

## Запуск локально
Требуются Node (через fnm) и Docker (Colima).

```bash
eval "$(fnm env)" && npm install
docker compose up -d              # Postgres на localhost:5433
cp .env.example .env              # при первом запуске
npm run db:migrate                # применяет миграции и запускает seed
npm run dev                       # http://localhost:3000
```

Seed создаёт квест, админа «Роман» и трёх тестовых участников.

## Как это работает
- **Вход** — только через Telegram (OpenID Connect, `TELEGRAM_CLIENT_ID`/`TELEGRAM_CLIENT_SECRET`).
  Аккаунт создаётся при первом входе; usernames из `TELEGRAM_ADMIN_USERNAMES` получают права админа.
  С российского сервера Telegram недоступен, поэтому серверные запросы идут через `TELEGRAM_PROXY_URL`.
- **Отчёт** (`/log`) — дата, тип активности, шаги, длительность, фото/видео, опционально задание бинго.
  При `autoApprove` (по умолчанию включён) отчёт засчитывается сразу; иначе попадает в очередь модерации.
- **Подсчёт** — чистая функция `computeScore` в `src/lib/scoring/` пересчитывает всё из отчётов на каждый запрос.
  Правила и тесты там же (`npm test`).
- **Админка** (`/admin`) — модерация, участники, ручные корректировки баллов, номинации, настройки.
- **Итоги** (`/results`) — открываются после 30 ноября или по флагу «Опубликовать итоги».

Загрузки хранятся в `./uploads` (переменная `UPLOAD_DIR`) и отдаются только авторизованным.

## Telegram-бот
Спецификация — [SPEC-TELEGRAM-BOT.md](SPEC-TELEGRAM-BOT.md). Отдельный процесс `scripts/bot.ts` (в проде — сервис `bot`
в `compose.prod.yml` на образе `-tools`) long-poll'ит Telegram через `TELEGRAM_PROXY_URL` (вебхуки с VPS не работают),
классифицирует сообщения группы через LLM (`LLM_BASE_URL`, CLIProxyAPI) и записывает отчёты через общий
`createReport` из `src/lib/reports/create.ts`. Веб-приложение с Telegram не общается вовсе. Бот молчалив: обычный
зачёт отмечается реакцией на исходном сообщении (🎃, либо 👌 если день уже был засчитан), а полноценный ответ уходит,
только если в нём есть кнопка или объяснение. Отчёты с сайта не анонсируются. Раз в неделю (вс 20:00 МСК) — дайджест.

Режимы `BOT_MODE`: `off` (не запускается), `shadow` (только классифицирует и пишет в лог на админке), `live`.
Первый запуск: задать `TELEGRAM_BOT_TOKEN`, отправить `/id` в группе, чтобы узнать `TELEGRAM_GROUP_CHAT_ID`, затем `shadow` на 2–3 дня.

```bash
npm run bot            # локально; нужны переменные из .env.example
npm run bot:eval       # прогон эвал-набора по промпту (нужен LLM)
npm run bot:import -- --dir ~/Downloads/ChatExport_…   # импорт истории чата из экспорта Telegram Desktop (JSON); --apply чтобы записать
npm run bot:replay-shadow                                # при переходе в live: записать отчёты, которые бот только фиксировал в shadow
```

## Скрипты
| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер |
| `npm test` | vitest (движок подсчёта) |
| `npm run lint` | eslint |
| `npm run db:migrate` | prisma migrate dev + seed |
| `npm run db:seed` | только seed |
| `npm run db:studio` | Prisma Studio |
| `npm run bot` | Telegram-бот (worker) |
| `npm run bot:eval` | эвал LLM-извлечения |

## Принятые допущения (уточнить у организатора)
См. раздел «Open Questions» в SPEC.md. По умолчанию: бонусы за стрик суммируются (7 дней = +17) и счётчик
обнуляется после 7; бинго само по себе не делает день активным; 10 000+ шагов делают день активным.

## Деплой на VPS (tl-sport.ru)
Продакшен — один сервер с Docker Compose: `compose.prod.yml` поднимает Postgres, приложение и Caddy
(автоматический HTTPS для `DOMAIN`, плюс HTTP-фолбэк на голый IP).

Разово на сервере: установить Docker, создать `/opt/sport-quest/.env.prod` по образцу `.env.prod.example`
(сгенерировать `POSTGRES_PASSWORD` и `SESSION_SECRET` через `openssl rand -hex 32`).

### Деплой идёт сам: push в `main` → прод

**Отдельного шага «выкатить» нет.** Любой коммит в `main` запускает
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), и через ~2–3 минуты изменения уже на
tl-sport.ru. `check` и `build` идут параллельно, `deploy` ждёт обоих (`needs: [check, build]`):

1. **check** — `npm ci`, `prisma generate`, `npm run lint`, `npm test`. `DATABASE_URL` здесь фиктивный:
   он нужен только чтобы резолвился `prisma.config.ts`, к базе никто не подключается.
   Красные тесты останавливают деплой.
2. **build** — два образа в GHCR из одного `Dockerfile`: стадия `runner` → `:<sha>` и `:latest`
   (само приложение), стадия `build` → `:<sha>-tools` и `:latest-tools` (полный исходник с `tsx` и
   Prisma CLI — на нём работают бот и разовые команды). Слои кешируются через `type=gha`.
3. **deploy** — окружение `production`: поднимает SSH-ключ из секретов и вызывает тот же `./deploy.sh`
   с `IMAGE_TAG=<sha>`. `concurrency: deploy-production` без `cancel-in-progress` — два деплоя никогда
   не идут внахлёст, следующий ждёт в очереди.

Секреты репозитория: `DEPLOY_HOST` (`root@<vps>`), `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.

Что делает сам `deploy.sh` (он одинаковый для CI и для ручного запуска): rsync'ит на сервер только
`compose.prod.yml`, `Caddyfile` и себя → дописывает `IMAGE_TAG` в `.env.prod` (чтобы ручной
`docker compose up -d` на сервере поднял те же образы, а не случайный `latest`) → `pull` → `up -d
--remove-orphans` → **`prisma migrate deploy`** → чистит старые образы и кеш билдера.
То есть миграции применяются на каждом деплое автоматически.

Ручной запуск нужен в трёх случаях:

```bash
# 1. Откатиться на прошлый образ (тег = SHA любого зелёного коммита)
IMAGE_TAG=<sha> DEPLOY_HOST=root@<vps> ./deploy.sh

# 2. Передеплоить без нового коммита — вкладка Actions → Deploy → Run workflow (workflow_dispatch)

# 3. Выкатить с ноутбука в обход CI (если GitHub лежит); соберёт НЕ ваш код, а :latest из GHCR
DEPLOY_HOST=root@<vps> ./deploy.sh
```

Статус выкатки: `gh run list --workflow=deploy.yml` или `gh run watch`.

Первый запуск — создать квест и админа (без тестовых участников):
```bash
ssh "$DEPLOY_HOST" 'cd /opt/sport-quest && docker compose -f compose.prod.yml --env-file .env.prod run --rm tools npx tsx prisma/seed.ts'
```
Дальше участники сами входят через Telegram.

Бэкап: `docker compose -f compose.prod.yml --env-file .env.prod exec db pg_dump -U sportquest sportquest > backup.sql`
и volume `uploads`.
