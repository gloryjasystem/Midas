# ADR-011: SecureStorage for Sensitive Data in TMA

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Telegram Mini App работает в WebView. Стандартные хранилища (localStorage, sessionStorage, cookies) доступны через DevTools, JS-инъекции и не защищены от вредоносных расширений. Для финансовой системы — неприемлемо. (МП §Этап4, PC §7.3)

## Решение

**SecureStorage** (Bot API 9.0+) с биометрической аутентификацией.

### Правила хранения на клиенте

| Тип данных | Хранилище | Биометрия |
|---|---|---|
| Приватные ключи (если потребуется) | SecureStorage | ✅ Обязательна |
| API tokens пользователя | ❌ Не хранить на клиенте | — |
| Настройки UI (тема, язык) | CloudStorage (Bot API) | ❌ |
| Кэш данных дашборда | Только в memory (React state) | ❌ |

### Архитектурное правило

```
ЗАПРЕЩЕНО на клиенте:
- localStorage.setItem(anything_sensitive)
- sessionStorage.setItem(anything_sensitive)
- document.cookie = anything_sensitive

РАЗРЕШЕНО:
- SecureStorage.setItem(key, value) — с биометрией
- CloudStorage — для несенситивных preferences
- React state / React Query cache — для runtime data
```

## Последствия

- Все OAuth токены — только на бэкенде (PC §7.4)
- Mini App получает данные через API с валидацией initData
- SecureStorage API — через `@telegram-apps/sdk-react`
- Если устройство не поддерживает биометрию — fallback: не хранить вообще
- Lint rule: запретить `localStorage`/`sessionStorage` в TMA-коде
