# ADR-001: Runtime Selection — Node.js + TypeScript

**Статус:** ACCEPTED
**Дата:** 2026-05-04
**Решение принято:** Владелец проекта

---

## Контекст

ТЗ заказчика (Midaz_TZ v1, §2) рекомендует **Python (FastAPI + aiogram)** как основной бэкенд. Мастер-план v2.0 переключает на **Node.js**. Требуется окончательное решение, так как оно влияет на:
- Бот-фреймворк (aiogram = Python-only vs grammY/telegraf = Node.js)
- Очередь задач (Celery = Python-only vs BullMQ = Node.js)
- Frontend/Backend code sharing (TypeScript ↔ React)
- Наём разработчиков и единообразие стека

## Рассмотренные варианты

### Вариант A: Python (FastAPI + aiogram)
| Плюсы | Минусы |
|---|---|
| Соответствует исходному ТЗ | Два языка в стеке (Python + JS для React TMA) |
| aiogram — зрелый Telegram bot фреймворк | Нет code sharing между бэкендом и фронтендом |
| FastAPI — отличная документация и типизация | Celery — тяжёлый для простых задач |
| Сильные ML/AI библиотеки | Дополнительная сложность деплоя (2 runtime) |

### Вариант B: Node.js + TypeScript (ВЫБРАН)
| Плюсы | Минусы |
|---|---|
| Единый язык: бэкенд + фронтенд (TS) | Менее зрелые Telegram-фреймворки vs aiogram |
| Шаринг типов/моделей между apps | Отклонение от исходного ТЗ заказчика |
| BullMQ — легковесная замена Celery | Нужен строгий TypeScript для финансовой логики |
| Единый Turborepo монорепо | Event Loop — нужна дисциплина с Worker Threads |
| grammY/telegraf — активно развиваются | — |
| Нативная интеграция с Vite/React | — |

### Вариант C: Гибрид (Node.js core + Python микросервисы)
| Плюсы | Минусы |
|---|---|
| Лучшее из обоих миров | Сложность инфраструктуры |
| Python для ML/heavy analytics | Два runtime в проде |
| Node.js для API/bot/realtime | Межсервисная коммуникация |

## Решение

**Node.js 24 LTS + TypeScript** — единственный runtime для:
- `apps/telegram-bot/` — бот (grammY / telegraf / raw webhook)
- `apps/mini-app/` — React 19 + Vite 8 TMA
- `apps/background-workers/` — BullMQ workers

**Python** зарезервирован как опция для будущего изолированного микросервиса (heavy analytics/reporting), если Node.js Worker Threads окажутся недостаточны.

**n8n** отклонён для основной продуктовой логики.

## Обоснование

1. **Единый стек** снижает когнитивную нагрузку и стоимость сопровождения
2. **TypeScript** обеспечивает строгую типизацию для финансовых данных (DECIMAL, currency types)
3. **Code sharing** между бэкендом и фронтендом через `packages/` в Turborepo
4. **BullMQ** (Redis-backed) покрывает все потребности в очередях задач без overhead Celery
5. **grammY** — активно развивается, имеет middleware, sessions, TypeScript-first API

## Последствия

- Все `packages/` в монорепо — TypeScript
- Strict TypeScript config: `strict: true`, `noUncheckedIndexedAccess: true`
- Worker Threads обязательны для CPU-intensive задач (PDF, charts) — см. PC §5.3
- При обнаружении необходимости Python-микросервиса — создать отдельный ADR
- Celery полностью исключён из архитектуры
- aiogram полностью исключён из архитектуры
