# Repository Guidelines

## Project Structure & Module Organization
`index.html` is the main application and contains the UI, CSS, client-side state, and Supabase sync entrypoint in one SPA file. Keep related edits close to the existing section they affect rather than scattering new logic. Cloud AI logic lives in `supabase/functions/ai-assistant/index.ts` as a Supabase Edge Function. Repository notes for agent workflows are in `CLAUDE.md`. Static assets currently live at the root, for example `favicon.ico`.

## Build, Test, and Development Commands
This repository has no `package.json` or build pipeline.

- `open index.html` or open the file directly in a browser: run the app locally.
- `supabase functions serve ai-assistant`: serve the Edge Function for local testing.
- `supabase functions deploy ai-assistant`: deploy the function after validation.

There are no configured lint, build, or automated test commands at this time.

## Coding Style & Naming Conventions
Follow the existing file-local style instead of reformatting large sections. In `index.html`, preserve the current HTML/CSS/JS organization and surrounding indentation. In the Edge Function, keep TypeScript/Deno patterns consistent with `index.ts`.

Comments are required for new or modified code and should be written in Chinese; technical keywords may remain in English. Use clear camelCase names for variables and functions, and keep DOM/CSS names descriptive, for example `plan-section-container` or `currentTaskDescription`.

When mutating app state, keep the existing sequence intact: update `window` data, refresh the relevant UI, then persist with `triggerSync()` or `debouncedSave()`.

## Testing Guidelines
There is no automated test suite yet. Validate frontend changes manually in the browser, including timer flow, todo/plan updates, import/export, theme behavior, and cloud sync. For AI function changes, test both readonly replies and preview patch responses with `supabase functions serve ai-assistant`.

## Commit & Pull Request Guidelines
Recent git history uses very short subjects such as `New`, but contributors should use clearer imperative commit messages instead, for example `ui: fix paused timer sync` or `ai: whitelist patch keys`. Keep commits focused.

Pull requests should describe user-visible behavior changes, note any Supabase or secret requirements, and include screenshots or short recordings for UI changes. Link the relevant issue when one exists.

## Security & Configuration Tips
Do not hardcode server secrets in frontend code. Edge Function secrets belong in Supabase secrets: `AI_API_KEY`, `AI_BASE_URL`, and optionally `AI_MODEL`.