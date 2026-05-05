# MVP Acceptance Criteria (Phase 1)

**Статус:** DRAFT (Phase 0.3.1 — Security Patch Applied)

Критерии приёмки для завершения Фазы 1 (Strict MVP).

## 1. Инфраструктура и БД
- [ ] База данных PostgreSQL развёрнута.
- [ ] Схема БД соответствует `database_model_draft.md`.
- [ ] RLS политики корректно изолируют данные между `workspace_id`.
- [ ] Redis и BullMQ развёрнуты. Работают очереди `webhook-ingestion`, `ai-parse`, `notifications`.
- [ ] Типы для денег используют `NUMERIC(19,4)` и библиотеку `decimal.js` (запрещены float/Number).
- [ ] **SEC-03:** Все tenant-scoped операции проходят через `withTenantTransaction`.
- [ ] **SEC-03:** Тест подтверждает, что после ошибки в транзакции контекст workspace НЕ утекает в пул.

## 2. Webhook & Security
- [ ] **SEC-04:** Webhook валидирует `X-Telegram-Bot-Api-Secret-Token`. Невалидные запросы → 403.
- [ ] **SEC-05:** voice/video/photo/sticker/document → не попадают в AI-парсер, пользователь получает заглушку.
- [ ] **SEC-09:** User-level rate limit (5 msg / 10s per user) предотвращает спам до BullMQ.
- [ ] **SEC-09:** Global AI budget guard отслеживает суммарный расход токенов.

## 3. Onboarding (Бесшовный старт)
- [ ] Telegram Bot отвечает на `/start`.
- [ ] При первом обращении атомарно создаются `User`, `Workspace` (с `default_currency = 'RUB'`) и `WorkspaceMembership` (role='owner', is_default=true).
- [ ] Создаются дефолтные категории (Продукты, Транспорт, Зарплата).

## 4. Обработка Транзакций (AI Core)
- [ ] Пользователь отправляет свободный текст в бота.
- [ ] Бот ставит задачу в BullMQ (`ai-parse`) с idempotency key `parse:bot:{bot_id}:msg:{message_id}`.
- [ ] Claude Haiku парсит текст и возвращает JSON.
- [ ] **SEC-01:** AI output валидируется строгой Zod-схемой (allowlist). Системные поля отсечены.
- [ ] **SEC-01:** Malformed AI output → draft со статусом `needs_clarification` или `rejected`.
- [ ] **SEC-10:** Если пользователь не указал валюту → применяется `workspace.default_currency`.
- [ ] Создаётся запись в `TransactionDraft` (status=`pending_user`).

## 5. Human-in-the-loop (Подтверждение)
- [ ] Бот отправляет Inline-клавиатуру: "Расход: 500, Категория: Кофе. Верно? [Да] [Изменить]".
- [ ] **SEC-07:** Нажатие [Да] выполняет атомарный UPDATE (WHERE status='pending_user' AND expires_at > NOW()).
- [ ] **SEC-07:** Параллельные нажатия (race condition) → только одна Transaction создаётся. Обязателен тест.
- [ ] **SEC-07:** `transactions.draft_id` UNIQUE — вторая линия защиты.
- [ ] **SEC-08:** Expired/rejected draft НЕ МОЖЕТ быть подтверждён.
- [ ] **SEC-11:** exchange_rate фиксируется при COMMIT. Одновалютная → rate=1.0. Rate API down → ошибка.
- [ ] Клавиатура обновляется (убираются кнопки, пишется "✅ Сохранено").
- [ ] TTL для Draft (24 часа). CRON expire использует atomic UPDATE.

## 6. Финансовая точность
- [ ] **SEC-02:** `parseFloat`, `Number()`, `+val` запрещены в финансовых путях. ESLint rule активен.
- [ ] **SEC-02:** PG NUMERIC → Decimal через `pg.types.setTypeParser`. Тест подтверждает.
- [ ] **SEC-02:** Decimal → внешний мир только как string. Тест подтверждает.
- [ ] **SEC-11:** Исторические транзакции НИКОГДА не пересчитываются по текущему курсу.

## 7. Базовые Отчёты
- [ ] По команде `/balance` бот выдаёт текстовую сводку текущего баланса по счетам.
- [ ] По команде `/report` бот выдаёт текстовую сводку расходов/доходов за текущий месяц.

## 8. Управление Категориями
- [ ] `/category` показывает список категорий.
- [ ] `/add_category [Имя]` создаёт новую кастомную категорию для воркспейса.

## 9. Privacy & Observability
- [ ] **SEC-12:** raw_text НЕ попадает в Sentry/stdout/BullMQ логи.
- [ ] **SEC-12:** Логи содержат event_id, user_id_hash, workspace_id, draft_id, error_class.
- [ ] **SEC-06:** Idempotency keys корректно предотвращают дубли.

## Вне рамок MVP (Запрещено в Фазе 1)
- ❌ Крипто-транзакции и вебхуки блокчейнов.
- ❌ Google Sheets и Notion синхронизация.
- ❌ Telegram Mini App (TMA).
- ❌ Экспорт в PDF / Инфографика.
