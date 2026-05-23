ПРОЕКТ: Midas — Telegram-бот личных финансов (монорепо).
Платформа: Railway (auto-deploy из main).
Workspace: C:\Users\secvency\Desktop\Midas\midas-monorepo

═══ ОБЯЗАТЕЛЬНО ПРОЧТИ ДВА ФАЙЛА СНАЧАЛА ═══

1. MASTER SPEC (утверждённый архитектурный план — абсолютный источник истины):
   docs/phase2s2_voice_commands_smart_dialogue.md

   Там есть ВСЁ: 4 Blindspot'а, exact insertion points, 5 фаз с Gate'ами, полный код, сводка файлов.

2. ИСТОРИЯ ПРОЕКТА (40+ фаз, архитектура, Redis-ключи, что уже сделано):
   workflow_state.md

Оба файла лежат ВНУТРИ проекта. Прочитай их полностью перед любыми действиями.

═══ ЧТО НУЖНО СДЕЛАТЬ ═══

Реализуй Phase 2S2 (Voice Commands & Smart Dialogue) строго по Master Spec, фаза за фазой:

Phase 0: Инфраструктура
  0.1 — Создать packages/shared/src/command-router.ts (detectCommand)
  0.2 — Добавить userId в VoiceParseJobPayload + webhook + worker
  0.3 — Добавить [✖️ Отмена] в buildStartOnboardKeyboard()

Phase 1: Core Fast Router
  1.1 — Создать apps/telegram-bot/src/services/command-executor.service.ts
  1.2 — Вставить detectCommand() в webhook.route.ts (после L5320, перед NAV_BTN)

Phase 2: Voice Execution
  2.1 — Рефакторинг voice-parse.worker.ts: прямое исполнение команд вместо "Нажми кнопку"
        (с проверкой Redis states + nav dedup — описано в Blindspot 2 и 3 в Master Spec)

Phase 3: cancel_last
  3.1 — getLastTransaction() SQL + confirm card в command-executor

Phase 4: Polish
  4.1 — AI prompt (prompts.ts) — STT примеры для transfer/debt
  4.2 — HELP_TEXT — добавить 🎤 секцию
  4.3 — tsc --noEmit → push → deploy

═══ ПРАВИЛА ═══

- Все правки TypeScript — через Node.js .cjs-скрипты. НИКОГДА не использовать PowerShell Set-Content.
- После КАЖДОЙ фазы — выполнить Gate (чек-лист проверки из Master Spec).
- Не трогай файлы, которые не указаны в Master Spec (секция 5, сводка файлов).
- При ошибке tsc — исправь ДО перехода к следующей фазе.
- Начинай с Phase 0.1. Не пропускай фазы.
