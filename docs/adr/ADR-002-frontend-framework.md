# ADR-002: Frontend Framework Selection — React 19

**Статус:** ACCEPTED
**Дата:** 2026-05-04
**Решение принято:** Владелец проекта

---

## Контекст

ТЗ (§2) указывает **React / Vue** как варианты для Mini App. Мастер-план зафиксировал React 18 + Vite + Tremor UI. Требуется формальное решение.

## Рассмотренные варианты

### Вариант A: React 19 + Vite 8 (ВЫБРАН)
| Плюсы | Минусы |
|---|---|
| React 19 — Server Components, Suspense, Actions | Tremor Raw требует Tailwind |
| Tremor Raw — dashboard-ready компоненты | Больший bundle size vs Vue |
| `@telegram-apps/sdk-react` — официальная интеграция | — |
| TypeScript-first, code sharing с бэкендом | — |
| Наибольшая экосистема библиотек | — |
| Vite 8 — мгновенный HMR | — |

### Вариант B: Vue 3 + Vite
| Плюсы | Минусы |
|---|---|
| Меньший bundle size | Нет Tremor UI (только React) |
| Простой learning curve | `@telegram-apps/sdk-vue` — менее зрелый |
| Composition API — гибкость | Два разных подхода к типизации (Vue SFC vs TSX) |
| — | Меньше специалистов на рынке |

## Решение

**React 19.x + Vite 8.x + Tremor Raw**. Vue полностью исключён из scope.

## Обоснование

1. **Tremor Raw** — единственный dashboard UI kit, полностью совместимый с React. Отсутствует для Vue.
2. **`@telegram-apps/sdk-react`** — первоклассная поддержка React-хуков для TMA API (initData, theme, viewport, safeArea).
3. **TypeScript sharing** — единые типы `Transaction`, `Category`, `Loan` между бэкендом (Node.js) и фронтендом через `packages/`.
4. **Экосистема** — Recharts/Plotly для инфографики, React-PDF для генерации на клиенте.

## Последствия

- `apps/mini-app/` — React 19 + Vite 8 + Tremor Raw
- Tailwind CSS требуется для Tremor Raw
- Роутинг через `react-router` с `startapp` параметром (PC §4.3)
- `safeAreaInset` и `hideKeyboard` — через `@telegram-apps/sdk-react`
