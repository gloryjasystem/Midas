# Midas — Phase 2 Roadmap: Crypto Monitoring & Intelligence

> **Статус:** Утверждён к реализации после закрытия Phase 1
> **Дата:** 2026-05-16
> **Принцип Phase 2:** Автоматизация учёта — система сама видит транзакции и предлагает их категоризировать

---

## Что уже сделано в Phase 1 (не повторяем)

| Фича | Статус | Коммит |
|---|---|---|
| Голосовые транзакции (Whisper/STT + нормализация) | ✅ DONE | `4a38176`, `f4eb9c1`, `3696042` |
| Голосовые команды (router через тот же AI) | ✅ DONE | включено в STT pipeline |
| Currency-aware account picker | ✅ DONE | `04f7e81`, `0085d8f` |
| State-aware reminders + chat hygiene | ✅ DONE | `cc26652`, `7ea5bf2` |
| Clarification context (multi-turn AI) | ✅ DONE | `4a38176` |

---

## Ключевая идея Phase 2

Phase 1 — ручной ввод. Ты пишешь «потратил 500», система записывает.

Phase 2 — **автоматический мониторинг**. Ты подключаешь крипто-кошелёк, и каждый раз когда с него уходят или приходят деньги — Midas видит это сам, отправляет уведомление, и ждёт пока ты скажешь «это реклама» или «это доход с фриланса».

---

## БЛОК A: Крипто-мониторинг (Phase 2.1–2.3)

---

### Phase 2.1 — Подключение крипто-кошельков

**Зачем:** Пользователь хочет видеть все движения по крипто-адресам без ручного ввода.

**Принцип:** ТОЛЬКО публичный адрес. Приватный ключ и seed-фраза никогда не запрашиваются.

**Поддерживаемые сети:**

| Сеть | Токены | API |
|---|---|---|
| TRC20 (Tron) | USDT TRC20, TRX | Tronscan API / TronGrid |
| BEP20 (BSC) | USDT BEP20, BNB | BSCScan API |
| ERC20 (Ethereum) | USDT ERC20, ETH | Etherscan API |

**UX — добавление:**

```
/wallets → [➕ Добавить кошелёк]

Выбери сеть:
[🔶 TRC20 — Tron] [🟡 BEP20 — BSC] [🔷 ERC20 — ETH]

> TRC20

Вставь публичный адрес:
> TJRabPrwbZy45sbavfcjinPJC2...

🔍 Проверяю адрес...
✅ Адрес найден. Сеть: TRC20. Токены: USDT, TRX

Как назвать кошелёк?
[Trust Wallet TRC20] [✏️ Своё название]

Загрузить историю за последние 30 дней?
[✅ Да] [⏭️ Нет, только новые]
```

**Управление /wallets:**

```
₿ Мои кошельки:

▸ Trust Wallet TRC20 — TJRabP...cfcji — 🟢 активен
▸ MetaMask ERC20     — 0x7ab3...c891  — 🟢 активен

[➕ Добавить] [✏️ Изменить] [🗑️ Удалить]
```

**Технические правила:**
- До 5 адресов на пользователя (MVP)
- UNIQUE: `(workspace_id, address, network)` — нельзя добавить дважды
- Polling: каждые 15 минут через BullMQ CRON worker
- Идемпотентность: UNIQUE `(tx_hash, network_id)` — дубли игнорируются

**Новые таблицы:**

```sql
CREATE TABLE crypto_wallets (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  address TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('TRC20','BEP20','ERC20')),
  label TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, address, network)
);

CREATE TABLE blockchain_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  wallet_id TEXT NOT NULL REFERENCES crypto_wallets(id),
  tx_hash TEXT NOT NULL,
  network TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC(19,8) NOT NULL,
  token TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','categorized','ignored')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tx_hash, network)
);
```

---

### Phase 2.2 — Алерты и категоризация on-chain транзакций

**Главная фишка Phase 2.** Транзакция пришла → алерт → одним нажатием категоризируешь.

**Карточка входящей транзакции:**

```
💰 Входящий перевод

▸ Trust Wallet TRC20
  +500.00 USDT
  От: TXq8k...p3rM
  16 мая, 14:32

Что это было?
[💼 Доход] [🔄 Перевод между своими] [⏭️ Игнорировать]
```

Нажал [💼 Доход]:

```
📁 Выбери категорию:
[💻 Фриланс] [📢 Реклама] [💰 Инвестиции]
[🏷️ Другое]  [✏️ Ввести вручную]

> [💻 Фриланс]

✅ Записано: +500.00 USDT — Фриланс
   🏦 Trust Wallet TRC20
[✏️ Изменить] [📊 Баланс]
```

Нажал [🔄 Перевод между своими]:

```
Откуда пришло?
[Binance] [MetaMask] [✏️ Другой источник]

> [Binance]

✅ Перевод Binance → Trust Wallet: 500.00 USDT
   Баланс обоих счетов обновлён.
```

**Карточка исходящей транзакции:**

```
💸 Исходящий перевод

▸ Trust Wallet TRC20
  −200.00 USDT
  Кому: T9xmK...a7Vc
  16 мая, 15:10

На что потратил?
[💸 Расход] [🔄 Перевод между своими] [⏭️ Игнорировать]
```

Нажал [💸 Расход]:

```
📁 Выбери категорию:
[📢 Реклама] [💻 Сервисы] [🛒 Покупки]
[🏷️ Другое]  [✏️ Ввести вручную]

> [📢 Реклама]

Что именно? (необязательно)
> Facebook Ads

✅ Записано: −200.00 USDT — Реклама — Facebook Ads
   🏦 Trust Wallet TRC20
```

**AI-подсказка по известному адресу:**

```
💸 Исходящий перевод — MetaMask ERC20 −0.05 ETH
Кому: Binance Hot Wallet

✨ Похоже на перевод на биржу.
[🔄 Перевод на биржу] [💸 Другой расход] [⏭️ Игнорировать]
```

**Порог уведомлений (защита от спама):**

```
/wallets settings

Минимальная сумма для алерта:
[1 USDT] [10 USDT] [100 USDT] [✏️ Своя]
```

---

### Phase 2.3 — История и пакетная категоризация

**При добавлении кошелька:**

```
📥 Загрузка истории Trust Wallet TRC20

Период: [7 дней] [30 дней] [90 дней] [✏️ С даты]

🔍 Загружаю... найдено 47 транзакций

✅ Загружено:
   💰 Входящих:  12 (15,420 USDT)
   💸 Исходящих: 35 (9,800 USDT)

Хочешь разобрать их?
[✅ По одной] [⏭️ Позже]
```

**Режим пакетной категоризации (по одной):**

```
📋 Неразобранных: 47

1 из 47:
💸 −500 USDT | 12 мая | Кому: T9xmK...

[💸 Расход] [🔄 Перевод] [⏭️ Пропустить] [🚫 Игнорировать все похожие]
```

**Команда /uncategorized:**

```
/uncategorized

📋 Неразобранных транзакций: 12

💰 +200 USDT | 14 мая | Trust Wallet
💸 −50 USDT  | 13 мая | MetaMask

[📋 Разобрать] [⏭️ Пропустить все]
```

---

## БЛОК B: Vision AI (Phase 2.4)

---

### Phase 2.4 — Распознавание фото и скриншотов

**Зачем:** Пользователь получил чек или скриншот выписки — отправляет фото, Midas сам извлекает данные.

**Технология:** Claude Vision (claude-3-5-sonnet) или GPT-4o Vision

**Happy path:**

```
📸 [скриншот выписки Binance: вывод 127.50 USDT]

🔍 Анализирую...

💸 Нашёл:
   −127.50 USDT
   Комиссия вывода, Binance, 16 мая

[✅ Записать] [✏️ Изменить] [❌ Нет]
```

**Неясная валюта:**

```
📸 [рукописный чек — цифры читаются, валюта нет]

🤔 Вижу сумму: 1,250. В чём?
[USDT] [RUB] [USD] [✏️ Другая]
```

**Несколько транзакций на скриншоте:**

```
📸 [выписка банка — 3 операции]

Нашёл 3 транзакции:
1. −3,500 RUB | Продукты | 15 мая
2. −890 RUB   | Транспорт | 15 мая
3. +45,000 RUB | Зачисление | 14 мая

[✅ Записать все] [📋 По одной] [❌ Отмена]
```

---

## БЛОК C: Авто-курсы и переводы (Phase 2.5–2.6)

---

### Phase 2.5 — Авто-курсы из API

**Источники:**
1. Binance Public API (крипта)
2. CoinGecko API (крипта, бесплатный)
3. ExchangeRate-API (фиат: USD/EUR/RUB/UAH)

**В /balance:**

```
Было:
▸ MetaMask — 1.25 ETH
▸ Карта Сбер — 48,321 RUB

Стало:
▸ MetaMask — 1.25 ETH ≈ 3,562.50 USDT (курс: $2,850)
▸ Карта Сбер — 48,321 RUB ≈ 532 USDT (курс: 90.8)

📊 Итого ≈ 12,094.50 USDT
   Курсы обновлены: 16 мая 15:30
```

**Правила:**
- Курсы кэшируются в Redis TTL 15 минут
- При недоступности API — последний известный курс + пометка «курс устарел»
- Исторические данные НЕ пересчитываются — только отображение

```sql
CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate NUMERIC(19,8) NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (from_currency, to_currency, source)
);
```

---

### Phase 2.6 — Двусторонние переводы между счетами

**Зачем:** «Перевёл с Binance на карту» — не расход и не доход. Два счёта меняются одновременно, в P&L не влияет.

```
«Перевёл 20,000 рублей с карты на наличные»

🔄 Перевод между счетами:
   Карта Сбер → −20,000 RUB
   Наличные   → +20,000 RUB

[✅ Верно] [✏️ Изменить] [❌ Отмена]
```

```
«Вывел 500 USDT с Binance на Trust Wallet»

🔄 Перевод между кошельками:
   Binance TRC20      → −500.00 USDT
   Trust Wallet TRC20 → +500.00 USDT

[✅ Верно] [✏️ Изменить] [❌ Отмена]
```

**Схема:**

```sql
ALTER TABLE transactions
  ADD COLUMN transfer_group_id TEXT,
  ADD COLUMN transfer_direction TEXT CHECK (transfer_direction IN ('out','in'));
```

Два record'а с одним `transfer_group_id`. При мониторинге кошельков — система автоматически связывает пары если обе стороны подключены.

---

## БЛОК D: Автоматизация (Phase 2.7–2.8)

---

### Phase 2.7 — Регулярные транзакции (/recurring)

**Правило:** Система НИКОГДА не записывает автоматически. Только напоминает и ждёт нажатия.

**Умное предложение после 3-й похожей транзакции:**

```
✅ Записано: VPN — 50.00 USDT

💡 Вижу, ты записываешь это каждый месяц.
   Сделать автоматическим напоминанием?

[🔄 Да, каждый месяц] [❌ Нет]
```

**Ручное создание /recurring:**

```
/recurring → [➕ Добавить]

Что за платёж?
> Spotify 9.99 USDT

Как часто?
[Каждый месяц] [Каждую неделю] [Каждый год]

Какого числа?
[1-го] [5-го] [15-го] [Последний день] [✏️ Другое]

✅ Spotify — 9.99 USDT — каждый месяц, 1-го числа
```

**Напоминание в день платежа (09:00 по timezone пользователя):**

```
🔔 Регулярный платёж:
💸 Spotify — 9.99 USDT

[✅ Записать] [⏭️ Пропустить] [✏️ Изменить сумму]
```

```sql
CREATE TABLE recurring_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES account_sources(id),
  category_id TEXT REFERENCES categories(id),
  item_name TEXT,
  amount NUMERIC(19,4) NOT NULL,
  currency TEXT NOT NULL,
  intent TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  day_of_month INTEGER,
  next_due_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Phase 2.8 — Бюджеты и лимиты (/budget)

**Правило:** Бюджет НИКОГДА не блокирует запись транзакции — только информирует.

**Создание:**

```
/budget → [➕ Создать бюджет]
→ Категория: [Реклама]
→ Сумма: 2000 USDT / Месяц

✅ Реклама — до 2,000 USDT / месяц
```

**Отображение /budget:**

```
📊 Бюджеты за Май 2026:

☕ Кофе:      87 / 200 USDT (44%)  [████░░░░░░]
📢 Реклама: 1,800 / 2,000 USDT (90%) [█████████░] ⚠️
🛒 Продукты: 2,400 / 2,000 USDT (120%) [██████████] 🔴
```

**Уведомления при записи транзакции:**

При 80%:
```
✅ Записано: Реклама — 200 USDT

⚠️ Бюджет Реклама: 1,800 / 2,000 USDT (90%)
   Осталось 200 USDT до конца месяца.
```

При 100%+:
```
🔴 Бюджет Реклама превышен! 2,050 / 2,000 (+50)
[📊 Подробнее] [😌 Ок]
```

```sql
CREATE TABLE budgets (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount NUMERIC(19,4) NOT NULL,
  currency TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('weekly','monthly','yearly')),
  notify_at_80 BOOLEAN DEFAULT true,
  notify_at_100 BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## БЛОК E: AI Intelligence (Phase 2.9)

---

### Phase 2.9 — Самообучение и персонализация

**2.9-A — Самообучение по истории:**

```
«наполнитель 800» → AI: Другое → изменил на: Питомцы (3 раза)
«наполнитель 900» → AI: Питомцы ✅  (система обучилась)
```

```sql
CREATE TABLE user_category_overrides (
  id TEXT PRIMARY KEY DEFAULT gen_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  item_pattern TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  hit_count INTEGER DEFAULT 1,
  UNIQUE (workspace_id, item_pattern)
);
```

**2.9-B — Персональные категории в AI:**

```
Создал категорию «Авто»
«масло моторное 1200» → предлагает «Авто» вместо «Транспорт»
```

**2.9-C — Региональный bias:**

```
Пользователь пишет в UAH → усиленный bias украинских магазинов
Пользователь пишет в USD → bias американских брендов
```

---

## Сводная таблица Phase 2

| Фаза | Название | Суть | Внешние API | Размер |
|---|---|---|---|---|
| **2.1** | Подключение кошельков | TRC20/BEP20/ERC20 адреса | Tronscan, BSCScan, Etherscan | Большая |
| **2.2** | Алерты и категоризация | Уведомление о каждой on-chain tx | — | Большая |
| **2.3** | История кошельков | Загрузка прошлых транзакций | Те же blockchain API | Средняя |
| **2.4** | Vision AI | Фото чеков → транзакция | Claude Vision / GPT-4o | Средняя |
| **2.5** | Авто-курсы | Конвертация в USDT для сводки | CoinGecko, Binance, ExchangeRate | Средняя |
| **2.6** | Двусторонние переводы | Перемещение между своими счетами | — | Средняя |
| **2.7** | Регулярные транзакции | Напоминания, автопредложение | — | Большая |
| **2.8** | Бюджеты/Лимиты | Контроль по категориям | — | Средняя |
| **2.9** | AI Самообучение | Персональные категории, история | — | Средняя |

---

## Порядок реализации Phase 2

```
1. Phase 2.5 — Авто-курсы
   (нет внешних зависимостей внутри архитектуры, нужны для баланса)

2. Phase 2.6 — Двусторонние переводы
   (нет внешних API, нужны до крипто-мониторинга)

3. Phase 2.1 → 2.2 → 2.3 — Крипто-мониторинг
   (основная ценность Phase 2, блок целиком)

4. Phase 2.7 — Регулярные транзакции
   (автономно, зависит от timezone в настройках)

5. Phase 2.8 — Бюджеты
   (зависит от 2.5 для мультивалютных лимитов)

6. Phase 2.4 — Vision AI
   (самостоятельный модуль, внешний API)

7. Phase 2.9 — Самообучение
   (поверх всего, когда накоплена история)
```

---

## Ключевые принципы Phase 2

1. **HitL сохраняется** — ни одна blockchain-транзакция не записывается без подтверждения
2. **Приватные ключи — табу** — только публичные адреса, read-only
3. **Идемпотентность** — `(tx_hash, network)` UNIQUE — дубли от API игнорируются
4. **Курсы не пересчитывают историю** — только отображение текущего баланса
5. **Переводы не влияют на P&L** — не считаются расходом/доходом в отчётах
6. **Бюджет не блокирует** — только информирует
7. **Recurring — напоминай, не автоматизируй** — пользователь всегда нажимает вручную
