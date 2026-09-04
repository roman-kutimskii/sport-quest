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

## Скрипты
| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер |
| `npm test` | vitest (движок подсчёта) |
| `npm run lint` | eslint |
| `npm run db:migrate` | prisma migrate dev + seed |
| `npm run db:seed` | только seed |
| `npm run db:studio` | Prisma Studio |

## Принятые допущения (уточнить у организатора)
См. раздел «Open Questions» в SPEC.md. По умолчанию: бонусы за стрик суммируются (7 дней = +17) и счётчик
обнуляется после 7; бинго само по себе не делает день активным; 10 000+ шагов делают день активным.

## Деплой на VPS (tl-sport.ru)
Продакшен — один сервер с Docker Compose: `compose.prod.yml` поднимает Postgres, приложение и Caddy
(автоматический HTTPS для `DOMAIN`, плюс HTTP-фолбэк на голый IP).

Разово на сервере: установить Docker, создать `/opt/sport-quest/.env.prod` по образцу `.env.prod.example`
(сгенерировать `POSTGRES_PASSWORD` и `SESSION_SECRET` через `openssl rand -hex 32`).

Каждый деплой с ноутбука:
```bash
./deploy.sh              # rsync → docker compose up --build → prisma migrate deploy
```

Первый запуск — создать квест и админа (без тестовых участников):
```bash
ssh root@82.146.60.122 'cd /opt/sport-quest && docker compose -f compose.prod.yml --env-file .env.prod run --rm tools npx tsx prisma/seed.ts'
```
Дальше участники сами входят через Telegram.

Бэкап: `docker compose -f compose.prod.yml --env-file .env.prod exec db pg_dump -U sportquest sportquest > backup.sql`
и volume `uploads`.
