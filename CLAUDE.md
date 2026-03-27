# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project summary

- Product is a Chinese time-tracking web app.
- Main app is a single-page file: `index.html` (UI + styles + app logic + cloud sync entrypoint).
- Cloud AI helper is a Supabase Edge Function: `supabase/functions/ai-assistant/index.ts`.
- Core data model is client-side `window` globals, synced to one Supabase row.

## Development commands

This repo has no Node toolchain (`package.json` absent), so build/lint/test commands are not configured.

- Run locally (main workflow): open `index.html` in a browser.
  - macOS shortcut: `open index.html`
- Build: N/A
- Lint: N/A
- Tests: N/A (no automated suite; single-test command not applicable)

Supabase function workflow (when modifying `supabase/functions/ai-assistant`):

- Local serve: `supabase functions serve ai-assistant`
- Deploy: `supabase functions deploy ai-assistant`
- Required secrets: `AI_API_KEY`, `AI_BASE_URL` (optional `AI_MODEL`)

## Architecture (big picture)

### 1) Runtime components

There are three important runtime pieces:

1. `index.html` non-module script: timer, plans, todos, questions, import/export, theming, rendering, AI modal interaction.
2. `index.html` module script: Supabase client init, initial load, save, realtime subscription.
3. `supabase/functions/ai-assistant/index.ts`: receives instruction/context from frontend, calls external LLM, returns readonly response or patch.

### 2) Frontend state model

Main state is stored in `window` globals:

- Collections: `records`, `dailyPlans`, `todos`, `questions`
- Timer/session: `currentTask`, `currentTaskDescription`, `startTime`, `pausedTime`, `isPaused`
- Cross-module links: `currentPlanId`, `currentTodoId`
- UI-only state: `todoGroupStates`

### 3) UI mutation and sync pipeline

Expected sequence for most mutations:

1. Mutate `window` state
2. Refresh UI (`update*List()` or `refreshAllUI()`)
3. Persist (`triggerSync()` for immediate writes; `debouncedSave()` for high-frequency input)

Sync guardrails:

- `triggerSync()` is async and delegates to `saveToCloud()`.
- `isDataLoaded` blocks writes before initial cloud load finishes.
- `saveToCloud()` normalizes date fields to ISO before upsert.

### 4) Supabase storage model

- Table: `time_tracker_cloud`
- Single-row document pattern: `id = "my_daily_data"`
- Entire app state is stored in row field `data` (JSON)
- Realtime subscription listens to UPDATE on that row and rehydrates local state via `handleDataLoad()`

### 5) AI assistant data flow

1. Frontend calls `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions` directly (model: `glm-5`, temperature: 0.2, response_format: json_object).
2. API Key is stored in `localStorage` under key `bigmodel_api_key`; user is prompted on first use. Key is never hardcoded.
3. LLM returns either:
   - `mode: "readonly"` (message only), or
   - `mode: "preview_patch"` (message + patch)
4. Frontend only applies patch keys from a strict whitelist, then `refreshAllUI()` + `await triggerSync()`.

> Note: Supabase Edge Function (`supabase/functions/ai-assistant/index.ts`) still exists but is **not used by the frontend**. It was bypassed because Supabase's egress IPs are blocked by bigmodel. Do not route AI calls through it unless the IP restriction is resolved.

### 6) AI patch whitelist

The Edge Function and frontend enforce a strict whitelist for patch keys. Allowed keys:

```
records, todos, questions, dailyPlans,
currentTask, currentTaskDescription, currentPlanId, currentTodoId,
startTime, pausedTime, isPaused
```

Any keys outside this whitelist are silently ignored.

### 7) Mobile responsive design

- Desktop: four-column layout (今日足迹, 今日规划, 待办清单, 灵感洞察)
- Mobile (<768px): single-panel view with swipe pagination
- Pagination state (`mobilePagerState`) is UI-only, not persisted to cloud

### 8) Behavior coupling to preserve

- `finishToday()` exports Excel, then clears `records` + `dailyPlans` only (keeps `todos` + `questions`).
- Completed todos are filtered out during load/import to prevent stale completed items reappearing.
- Todo completion uses two-step async sync (mark completed -> sync -> remove -> sync).
- Starting from todo removes the todo immediately and starts timer.

## Integrations

- SheetJS CDN (`XLSX.writeFile`) for Excel export.
- Supabase JS client CDN in `index.html` module script.
- Flomo webhook POST is used for review/insight sending.
- Supabase anon credentials are currently hardcoded in `index.html`; Edge Function secret values stay server-side.

## Repository-specific coding conventions

- **Mandatory:** add comments for all new/modified code.
- Comments should be in Chinese (technical keywords can stay in English).
- For multi-step async logic, document step order clearly in comments.
- When sync order matters, use `async/await` and `await triggerSync()`; avoid fire-and-forget writes.
- After mutating arrays (`records/todos/questions/dailyPlans`), refresh corresponding UI list before sync.
- If adding new theme variables, update both light (`:root`) and dark (`[data-theme="dark"]`) definitions.

## Other instruction sources checked

- `README.md`: not present
- `.cursorrules` / `.cursor/rules/`: not present
- `.github/copilot-instructions.md`: not present
