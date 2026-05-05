# ADR-003: Workspace Model — Multi-Ready Architecture with Single-Workspace MVP

**Статус:** ACCEPTED
**Дата:** 2026-05-04
**Решение принято:** Владелец проекта

---

## Контекст

ТЗ (§9) подразумевает одного пользователя = один аккаунт (Telegram User ID). Мастер-план вводит концепцию Workspace с RLS-изоляцией по `tenant_id`. Вопрос: один Workspace на юзера навсегда, или архитектура должна поддерживать мульти-workspace?

## Рассмотренные варианты

### Вариант A: Жёсткий 1:1 (User = Workspace)
| Плюсы | Минусы |
|---|---|
| Простейшая модель данных | Невозможность расширения (бизнес + личные) |
| Нет WorkspaceMembership | Рефакторинг БД при масштабировании |
| Меньше JOIN-ов | Нет шаринга workspace с партнёром/бухгалтером |

### Вариант B: Multi-workspace ready, MVP = 1 default (ВЫБРАН)
| Плюсы | Минусы |
|---|---|
| Архитектура готова к росту | Чуть сложнее начальная модель |
| WorkspaceMembership позволит шаринг | Дополнительная таблица |
| RLS на workspace_id — чистая изоляция | MVP не использует мульти |
| Бизнес + личные = 2 workspace (будущее) | — |

### Вариант C: Полный мульти-workspace с UI
| Плюсы | Минусы |
|---|---|
| Полная гибкость с первого дня | Сложный UX для MVP |
| — | Перегрузка онбординга |
| — | Переключатель workspace — лишний экран |

## Решение

**Вариант B: Multi-workspace ready, MVP = 1 Default Workspace.**

### Модель данных

```
User
  id: ULID (PK)
  telegram_id: BIGINT (UNIQUE)
  created_at: TIMESTAMPTZ

Workspace
  id: ULID (PK)
  name: TEXT (default: 'Default')
  created_at: TIMESTAMPTZ

WorkspaceMembership
  id: ULID (PK)
  user_id: ULID (FK → User)
  workspace_id: ULID (FK → Workspace)
  role: ENUM('owner', 'member', 'viewer')
  is_default: BOOLEAN (default: true)
  created_at: TIMESTAMPTZ
  UNIQUE(user_id, workspace_id)
```

### MVP-поведение
1. `/start` → создать User + Workspace + WorkspaceMembership(role=owner, is_default=true)
2. Все запросы автоматически используют `is_default=true` workspace
3. UI не показывает переключатель workspace
4. В бэкенде `SET LOCAL app.workspace_id = X` в каждой транзакции

### RLS-политика (концептуально)
```
-- Все tenant-scoped таблицы:
CREATE POLICY workspace_isolation ON transactions
  USING (workspace_id = current_setting('app.workspace_id')::ulid);
```

## Обоснование

1. **Стоимость подготовки** = 1 дополнительная таблица (WorkspaceMembership). Минимальный overhead.
2. **Стоимость миграции** если не подготовить = полный рефакторинг FK, RLS-политик, бэкенд-middleware. Критический долг.
3. **Будущие сценарии:** бизнес-workspace + личный, шаринг с партнёром/бухгалтером, team accounts.

## Последствия

- Все tenant-scoped таблицы имеют `workspace_id` (не `user_id`) как FK
- RLS-политики привязаны к `workspace_id`
- Middleware бота: resolve `telegram_id` → `user_id` → `default_workspace_id` → `SET LOCAL`
- При будущем введении мульти-workspace: добавить UI переключателя, не менять БД
- `WorkspaceMembership.role` позволит RBAC в будущем
