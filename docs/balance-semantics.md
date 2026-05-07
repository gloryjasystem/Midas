# Balance Semantics Design Document
> **Phase:** 1.20 — Design Document Only  
> **Status:** ✅ ACCEPTED — 2026-05-07  
> **Created:** 2026-05-07  
> **Purpose:** Define all semantic rules for the `/balance` command before any schema migration or implementation begins.  
> All decisions D1–D6 approved by owner. Phase 1.21 may proceed.

---

## Current System State (Live DB Facts)

Facts verified from live DB inspection before writing this document:

| Fact | Value | Implication |
|---|---|---|
| Total transactions | 809 | — |
| expense | 397 | Most common intent |
| income | 314 | Second most common |
| debt_given | 52 | Money lent to others |
| debt_received | 23 | Money borrowed |
| transfer | 23 | Internal movement |
| ALL base_amount values | Strictly positive (min 0.10) | **No sign encoding in DB. Every intent stores positive amounts.** |
| account_sources rows | 691 | — |
| Accounts with 0 transactions | 428 | Seeded defaults, no activity yet |
| initial_balance column | **Does not exist** | Must be added before opening-balance-aware calculation |
| transfer.dest_account_id | **Does not exist** | Transfer is one-sided in current schema |
| account_sources.currency | Always `TEXT NOT NULL` | Currency of the account |
| transactions.base_currency | Can differ from account currency | 8 EUR transactions on USD accounts confirmed |
| workspaces.default_currency | `'RUB'` DEFAULT | Workspace-level currency preference |

---

## Decision 1 (D1): Sign Rule per Transaction Intent

### Background

All `transactions.base_amount` values are stored as **strictly positive numbers** — there is no sign convention in the DB. The AI schema also enforces positive-only amounts (see `AmountString` regex in `ai-core/src/schemas.ts`). Therefore, `/balance` must define an explicit formula that assigns a sign to each intent.

### Options

**Option A — Standard Signed Formula (RECOMMENDED)**

Each intent maps to a multiplier applied to `base_amount`:

| Intent | Multiplier | Rationale |
|---|---|---|
| `expense` | **−1** | Money leaves the account |
| `income` | **+1** | Money enters the account |
| `debt_given` | **−1** | Cash physically left the account (lent to someone) |
| `debt_received` | **+1** | Cash physically entered the account (borrowed from someone) |
| `transfer` | see D3 | Depends on transfer model decision |

Formula:  
```
balance = initial_balance
        + SUM(income.base_amount)
        + SUM(debt_received.base_amount)   [if D2 = integrated]
        − SUM(expense.base_amount)
        − SUM(debt_given.base_amount)      [if D2 = integrated]
        ± transfer                         [depends on D3]
```

**Option B — Income/Expense Only, Debt Separate**  
Only `expense` (−1) and `income` (+1) affect the main balance number.  
`debt_given`, `debt_received`, `transfer` are shown as a separate section in the output but do not change the balance sum.

**Option C — Pure Income/Expense, Debt Ignored**  
Only `expense` and `income` are summed. Debt and transfer are omitted entirely from `/balance`.  
Risk: 75 live transactions (debt + transfer) would be silently invisible. Misleading.

### Recommendation
**Option A.** Debt physically moves money; treating it as neutral produces a wrong account balance. Option B is a reasonable alternative if the owner views debts as "off-balance-sheet" items.

### ⚠️ Owner Decision Required — D1
> **Choose sign model: A / B / C**  
> If A: confirm that `debt_given` = −1 and `debt_received` = +1.  
> If B: confirm that debt/transfer appear as a separate section in the output.

---

## Decision 2 (D2): Debt Integration vs Separate Section

### Background

`debt_given` and `debt_received` represent money that physically moved in/out of an account, but they are not traditional expenses or income. Some users track them as balance-affecting (Option A); others view them as "IOUs" that should not appear in the running account balance (Option B).

### Options

**Option A — Integrated Into Balance (RECOMMENDED)**  
- `debt_given` = −1: reduces balance (money left)  
- `debt_received` = +1: increases balance (money received)  
- `/balance` shows one number. Debt is silent — included in the total but not labelled separately.  
- Simplest implementation.

**Option B — Separate Section**  
- Debt does NOT change the main balance number.  
- `/balance` output shows:
  ```
  Баланс: 12,500.00 USD
  
  Долги выданные: 5 шт. на 875.00 USD
  Долги полученные: 2 шт. на 301.50 USD
  ```
- More semantically precise if user thinks of debt as "not my money yet."

**Option C — Hybrid: debt_given debits, debt_received is neutral until repaid**  
- `debt_given` = −1 (cash left account)  
- `debt_received` = 0 (revenue not confirmed until repaid)  
- Requires a "repaid" status on `transaction_drafts` or `transactions` — does not exist in current schema. **Not implementable in Phase 1 without additional schema work.**

### Recommendation
**Option A** for Phase 1. Simplest, no extra schema required. Option B is also safe and can be selected if the owner views debts as off-balance items. Option C is not feasible in Phase 1.

### ⚠️ Owner Decision Required — D2
> **Debt model: A (integrated into balance) / B (separate section)**  
> Option C is not available in Phase 1.

---

## Decision 3 (D3): Transfer Model

### Background

23 `transfer` transactions exist. The current schema has one row per transfer — only the source account is recorded. There is no `dest_account_id` column in `transactions`. If a user transfers 1000 USD from Account A to Account B, only one row exists (account_id = A, base_amount = 1000).

### Options

**Option A — One-sided Debit (source account only)**  
- Transfer = −1 on source account.  
- Destination is NOT credited (no column for it).  
- Result: workspace total balance drops by transfer amount each time (as if money left the workspace).  
- Semantically wrong at workspace level: 23 transfers × 1000 USD = −23,000 USD phantom loss.  
- **Not recommended.**

**Option B — Treat Transfer as Neutral, Show Separately (RECOMMENDED)**  
- Transfers are excluded from the balance sum.  
- Shown as informational in the output:  
  ```
  🔄 Переводы: 23 шт. на 23,000.00 USD (не учитываются в балансе)
  ```
- Avoids the phantom loss problem until a proper two-sided model is implemented.  
- No schema change needed.

**Option C — Future Two-sided Model (requires schema migration)**  
- Add `transactions.dest_account_id VARCHAR NULL`.  
- Debit source (−1), credit destination (+1).  
- Net effect on workspace total: 0 (money moved internally).  
- Existing 23 transfer rows have `dest_account_id = NULL` → must be treated as incomplete.  
- **Requires a `transactions` table migration — not in Phase 1.20 or 1.21 scope.**

### Recommendation
**Option B.** Avoids producing a misleading balance number. Transfers are visible but clearly labeled as not affecting balance. Option C is correct long-term but requires a `transactions` schema change that must be a separate phase.

### ⚠️ Owner Decision Required — D3
> **Transfer treatment: A (debit source, −1) / B (neutral, show separately) / C (future two-sided)**  
> Note: Option C requires a `transactions.dest_account_id` migration and is out of Phase 1.21 scope.

---

## Decision 4 (D4): `initial_balance` Design

### Sub-decision D4a — Is `initial_balance` Needed?

**Without `initial_balance`:**  
`balance = SUM(income) − SUM(expense)` (± debt per D2).  
Correct only for workspaces where every transaction since account creation was entered in Midas.  
Wrong for users who added Midas to an existing account with a non-zero opening balance.

**With `initial_balance` (RECOMMENDED):**  
Enables correct balance for all users.  
Migration: `ADD COLUMN initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0`.  
All 691 existing accounts get `initial_balance = 0` — correct because they were created without a stated opening balance. Users who need a non-zero opening balance can set it via a future `/set_balance` command.

### Sub-decision D4b — Should Negative `initial_balance` Be Allowed?

**Yes — do NOT add `CHECK (initial_balance >= 0)` (RECOMMENDED).**  
Rationale:  
- Credit cards, overdrafts, and loans have negative opening balances.  
- Adding a `CHECK >= 0` now requires a DROP CONSTRAINT migration when credit/loan accounts are introduced in a later phase.  
- The app layer (`/add_account` currently does not accept `initial_balance` input) prevents accidental negatives through the current write path.  
- An unconstrained `NUMERIC` column is safe — `DEFAULT 0` means all programmatically-created accounts start at zero.

### Sub-decision D4c — `initial_balance` Currency

**Currency of `initial_balance` = `account_sources.currency` (RECOMMENDED, implicit).**  
No extra column needed. Each account already has a `currency TEXT NOT NULL` column. The opening balance of a USD account is in USD; the opening balance of an RUB account is in RUB.  
Cross-currency workspace totals: conversion would require exchange rates — deferred to Phase 2+. In Phase 1, per-account balance is always in `account_sources.currency`.

### Sub-decision D4d — Is `initial_balance_at` (date anchor) Needed for Phase 1?

**No — defer `initial_balance_at` (RECOMMENDED for Phase 1).**  
Assumption: all transactions recorded in Midas occurred after account creation in Midas. Therefore `initial_balance` can be treated as the balance before the first Midas transaction without a timestamp anchor.  
This assumption is valid in Phase 1 because back-dated transaction entry (entering a transaction with `transaction_time` in the past) is not available in the current UI.  
Latent debt: if back-dating is introduced, `initial_balance_at` will be required. This is explicitly noted here so the design debt is visible.

### D4 Summary

| Sub-decision | Recommendation |
|---|---|
| D4a — Add `initial_balance`? | **Yes** — `NUMERIC(19,4) NOT NULL DEFAULT 0` |
| D4b — Allow negative? | **Yes** — no CHECK constraint |
| D4c — Currency = `account_sources.currency`? | **Yes** — implicit, no extra column |
| D4d — `initial_balance_at` for Phase 1? | **No** — defer; document assumption |

### ⚠️ Owner Decision Required — D4
> **Agree with all 4 sub-recommendations above?**  
> Or override any sub-decision (D4a / D4b / D4c / D4d)?

---

## Decision 5 (D5): `/balance` Output Format

### Options

**Option A — Workspace aggregate total only**
```
💰 Баланс (все счета)

Доходы: 148,000.00 USD
Расходы: 62,423.50 USD
Баланс: 85,576.50 USD
```
Simple. No per-account breakdown. Useful for single-account workspaces (most users in Phase 1).

**Option B — Per-account breakdown (RECOMMENDED)**
```
💰 Баланс по счетам

• Default (Ручной ввод) — USD
  Начальный баланс: 0.00
  Доходы: 148,000.00 | Расходы: 62,423.50
  Баланс: 85,576.50 USD

Итого (USD): 85,576.50
```
Shows per-account balance + workspace total. Most useful for personal finance.

**Option C — Combined (aggregate first, per-account on demand)**  
Two-pass output: aggregate total, then detail per account. More verbose. May hit Telegram message length limits for workspaces with many accounts.

**Option D — By intent (mirrors `/report` format)**  
Groups by intent with balance sign applied. Risk: confuses users who expect balance ≠ report.

### Currency Grouping
If a workspace has accounts in different currencies, balances are shown per-currency — no cross-currency conversion in Phase 1:
```
Итого (USD): 85,576.50
Итого (RUB): 12,300.00
```

### Debt/Transfer Display (conditional on D2/D3)
- If D2 = B (debt separate): show debt section after main balance.
- If D3 = B (transfer neutral): show transfer count/sum as informational footnote.

### Recommendation
**Option B.** Per-account breakdown gives the most value in a personal finance app. Users want to know per-account state. Workspace total is shown as a summary line at the bottom.

### ⚠️ Owner Decision Required — D5
> **Output format: A (aggregate total) / B (per-account) / C (combined)**  
> Show debt section separately even if D2 = A (integrated)?

---

## Decision 6 (D6): `/balance` Time Scope

### Background

`/report` already shows the **current month** summary grouped by intent. `/balance` should logically show a **running all-time balance** (not filtered by month) — it answers "what is in my account right now?" not "what happened this month?"

### Options

**Option A — All-time running balance (RECOMMENDED)**  
`WHERE transaction_time < NOW()` — all transactions from account inception.  
Answers: "What is my current balance?"

**Option B — Current month only**  
`WHERE transaction_time >= start_of_month AND transaction_time < start_of_next_month`.  
This is essentially a signed version of `/report` — provides little additional value.

**Option C — Date range (complex)**  
User specifies start/end date: `/balance 2026-01-01 2026-05-01`.  
Requires argument parsing — out of scope for Phase 1.

### Recommendation
**Option A.** All-time balance is the canonical meaning of "account balance" in personal finance. Option B duplicates `/report`. Option C is a Phase 2+ feature.

### ⚠️ Owner Decision Required — D6
> **Time scope: A (all-time) / B (current month) / C (date range)**

---

## Owner Decisions Summary

| # | Decision | Options | **Recommended** | **Owner Choice** |
|---|---|---|---|---|
| **D1** | Sign rule per intent | A (standard ±1) / B (debt separate) / C (income+expense only) | **A** | ✅ **A** |
| **D2** | Debt: integrated or separate? | A (integrated ±1) / B (separate section) | **A** | ✅ **A** |
| **D3** | Transfer model | A (debit source −1) / B (neutral, shown separately) / C (two-sided, future) | **B** | ✅ **B** |
| **D4a** | Add `initial_balance` column? | Yes / No | **Yes** | ✅ **Yes** |
| **D4b** | Allow negative `initial_balance`? | Yes (no CHECK) / No (CHECK >= 0) | **Yes** | ✅ **Yes** |
| **D4c** | `initial_balance` currency = `account.currency`? | Yes (implicit) / No (separate column) | **Yes** | ✅ **Yes** |
| **D4d** | `initial_balance_at` in Phase 1? | Yes (add column) / No (defer) | **No** | ✅ **No** |
| **D5** | Output format | A (aggregate) / B (per-account) / C (combined) | **B** | ✅ **B** |
| **D6** | Time scope | A (all-time) / B (current month) / C (date range) | **A** | ✅ **A** |

---

## Owner Approved Decisions

> **Approved:** 2026-05-07 by project owner.  
> All recommended options accepted without override. Phase 1.21 is unblocked.

### Approved Balance Formula (per D1 + D2 + D3)

```
balance(account) =
    initial_balance                          -- D4a: new column, DEFAULT 0
  + SUM(base_amount WHERE intent = 'income')          -- D1: +1
  + SUM(base_amount WHERE intent = 'debt_received')   -- D1+D2: +1, integrated
  − SUM(base_amount WHERE intent = 'expense')         -- D1: −1
  − SUM(base_amount WHERE intent = 'debt_given')      -- D1+D2: −1, integrated
  -- 'transfer' excluded from sum (D3: neutral)       -- shown separately
```

### Approved Schema Change (per D4)
- Column: `account_sources.initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0`
- No `CHECK (initial_balance >= 0)` — negative values allowed (credit cards, loans)
- No `initial_balance_at` column — deferred; assumption: all Midas transactions post-date account creation
- Currency of `initial_balance` = `account_sources.currency` (implicit, no extra column)

### Approved Output Format (per D5 + D6)
- Per-account breakdown + workspace currency totals
- All-time running balance (not filtered by month)
- Transfer shown as informational footnote (count + sum), does not affect balance
- Debt integrated into balance sum (not shown as separate section)

---

## Recommended Implementation Sequence (After D1–D6 Approval)

### Phase 1.21: `account_sources.initial_balance` Migration (if D4a = Yes)

**Scope — migration + smoke tests only, no TypeScript:**
- `packages/database/migrations/1778400000000_account-sources-initial-balance.js` (NEW)
  - `up()`: Pre-flight check (0 rows with invalid initial_balance) + `ALTER TABLE account_sources ADD COLUMN initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0`
  - `down()`: `ALTER TABLE account_sources DROP COLUMN IF EXISTS initial_balance`
- `packages/database/smoke-test-phase121.mjs` (NEW): ~20–24 smoke tests
  - Column exists, correct type, correct default
  - Existing 691 rows have `initial_balance = 0`
  - RLS: midas_app can INSERT with initial_balance, cannot set negative if D4b = No
  - Scope guard: no TypeScript changes in this phase
- No TypeScript, no route, no new commands, no new dependencies.

### Phase 1.22: `/balance` Command

**Scope (depends on D1–D6 approvals):**
- `apps/telegram-bot/src/services/balance.service.ts` (NEW)
  - `getAccountBalances(workspaceId, userId)`:
    - Per-account query: `SELECT a.id, a.name, a.type, a.currency, a.initial_balance, SUM(...) ...`
    - Apply D1 sign rule per intent in SQL `CASE WHEN` or TypeScript
    - Apply D2 (integrated / separate debt section)
    - Apply D3 (transfer neutral / debit)
    - Apply D6 (all-time / monthly filter)
    - Format per D5 (per-account / aggregate)
- `apps/telegram-bot/src/routes/webhook.route.ts` (MODIFY)
  - Add `/balance` to `KNOWN_COMMANDS` (7 → 8)
  - Add `/balance` handler block
  - Update `HELP_TEXT`
- `packages/database/smoke-test-phase122.mjs` (NEW): ~60–80 smoke tests

---

## Design Assumptions (Phase 1 Scope)

The following assumptions are made in this design and should be noted as latent debt:

1. **All transactions post-date account creation in Midas.** No back-dating UI exists. `initial_balance_at` not needed.
2. **Single-currency balances per account.** Cross-currency conversion deferred to Phase 2.
3. **Transfer is one-sided** (source only). Two-sided transfer requires `transactions.dest_account_id` — a separate future migration.
4. **`initial_balance` can only be set to 0 in Phase 1** (no `/set_balance` command yet). Future Phase 1.23+ will add a `/set_balance` command.
5. **No soft-delete.** Deleting an account or category is not implemented. All accounts in balance query are active.

---

## Scope Guard — What This Document Does NOT Decide

The following are explicitly out of scope for this design document and must not be implemented until a separate phase:

- `/set_balance` command (set opening balance)
- Two-sided transfer model (`transactions.dest_account_id`)
- Debt repayment tracking
- Cross-currency conversion in `/balance`
- Date-range balance (`/balance 2026-01-01`)
- Edit/delete of accounts or categories
- Any changes to existing commands
