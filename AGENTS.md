# Agent Notes

## Stack

- Backend: Node.js ESM/TypeScript in `src/server.ts`, tested with `node --test`.
- Frontend: React 19 + Vite 8 in `client/src`, built into `public/`.
- React Compiler: enabled in `vite.config.ts` with `@vitejs/plugin-react`'s `reactCompilerPreset()` via `@rolldown/plugin-babel`.
- Styling: Tailwind CSS 4 via `@tailwindcss/vite`, with shadcn-style local primitives in `client/src/components/ui`.
- UI dependencies: Radix primitives through `radix-ui`, `lucide-react` icons, `class-variance-authority`, `clsx`, and `tailwind-merge`.
- Lint/format: Oxlint and Oxfmt with root configs in `.oxlintrc.json` and `.oxfmtrc.json`.
- Package manager/runtime are pinned in `package.json`: Node `26.2.0`, pnpm `11.3.0`.

## Commands

- `pnpm dev` starts the Vite frontend dev server with API/media proxying.
- `pnpm typecheck` runs `tsc -b`.
- `pnpm lint` runs Oxlint for frontend and backend code.
- `pnpm format:check` checks Oxfmt formatting; `pnpm format` writes formatting changes.
- `pnpm check` runs typecheck, lint, format check, and frontend unit tests.
- `pnpm test:unit` runs focused Vitest tests for frontend helpers/components.
- `pnpm build` runs strict TypeScript checking, then Vite build.
- `pnpm test` runs the build, frontend unit tests, and then the Node/browser smoke tests.

Do not rely on Vite alone for type safety. The build intentionally includes `pnpm typecheck`.

## Auth Browser

- Backend-owned browser auth lives in `src/auth-browser.ts` and is wired through `/api/auth/browser/*` routes.
- Initial login is intentionally visible because the source account requires email/password/OTP.
- After login, the server reuses the same persistent Chrome profile headlessly to refresh Clerk tokens.
- The default profile path is `MEDIA_DIR/_auth_browser_profile`; override with `AUTH_BROWSER_PROFILE_DIR`.
- Tokens stay in memory only. Treat the browser profile as sensitive because it contains session state.
- The Chrome extension remains a fallback token sender to `/api/auth/token`, not the primary path.

## Background Sync

- The CLI server starts background incremental sync automatically by default.
- Defaults: boot sync after `AUTO_SYNC_STARTUP_DELAY_MS=10000`, then every `AUTO_SYNC_INTERVAL_MS=3600000`.
- Set `AUTO_SYNC_ENABLED=false` to disable scheduled syncs.
- Scheduled syncs must skip if `syncState.running` is already true; do not allow overlapping library jobs.

## TypeScript

TypeScript is strict. Keep it that way.

- Avoid implicit `any`, optional-prop ambiguity, and unchecked indexed access.
- Use shared domain types from `client/src/types/domain.ts` (client) or `src/types/domain.ts` (server)
- Feature-level prop types belong near the feature, such as `components/create/types.ts` and `components/library/types.ts`.
- Prefer typed helpers in `client/src/lib` (client) or `src/lib` (server) over ad hoc inline parsing or formatting.
- Use `as const` to get concrete types for arrays, sets, and objects where appropriate.
- Prefer `satisfies` for type assertions to preserve literal types and catch excess properties.
- Use discriminated unions for complex state or config objects with multiple variants.
- Explicit return types on exported functions are required. For internal functions, prefer inference unless the signature is complex or non-obvious.

## React Compiler

- Keep React components and hooks compatible with compiler assumptions.
- Treat Oxlint's hook/exhaustive dependency findings as real issues unless there is a specific reason to suppress them.
- Avoid broad memoization workarounds. Prefer clear data flow and stable hook dependencies.
- The production Vite build is the source of truth for compiler compatibility.

## Linting And Formatting

- Use Oxlint for correctness, React hooks, accessibility, imports, Node, Promise, and Vitest checks.
- Use Oxfmt for source/config formatting. Do not manually churn formatting that `pnpm format` will handle.
- The config intentionally disables noisy rules for modern JSX runtime, intentional sequential async loops, CSS side-effect imports, and routine inline React event handlers.

## Frontend Structure

- `client/src/App.tsx` should stay as orchestration only.
- `components/app` is for the app shell/navigation.
- `components/common` contains small reusable primitives.
- `components/create` owns the media creation flow.
- `components/library` owns the gallery/feed, filters, pager, inspector, and create dock.
- `components/media` owns media cards, previews, and detail dialogs.
- `components/ui` contains shadcn-style primitives; keep these generic.
- Hooks in `client/src/hooks` own data fetching and workflow state. Avoid large global state objects.

## UI Direction

The app should feel like a polished dark-only desktop media console that also works well on mobile.

- Prioritize fast scanning, dense information, low-friction creation, and clear local pipeline status.
- Make source reuse obvious: users should be able to create from gallery images, uploads, pasted images, dropped files, or URLs.
- Keep controls native-feeling and compact: icon buttons, segmented/tabs for modes, selects for option sets, and clear disabled states.
- Avoid marketing-page patterns. The first screen is the usable app.
- Mobile should preserve the core workflow, not become a stripped-down afterthought.
- Use real browser inspection/smoke tests after meaningful UI changes.

## Media Creation Notes

- Upload supports picker, drag/drop, and clipboard paste for images.
- URL sources are supported for image/video template flows where the backend mode allows them.
- Creation modes come from `/api/create/modes`; do not hard-code mode assumptions in UI components when backend config can provide them.
- Template import is backed by captured history prompts. Keep template UI extensible because custom templates are expected to grow.

## Testing Expectations

- Add or update mocked API tests for backend behavior.
- Add concise Vitest coverage for complex frontend helpers/components when it catches real workflow regressions.
- Keep browser smoke coverage for UI-critical flows: filters, menus, lazy media, detail dialogs, upload/create entry points, and responsive layout.
- Before handing off frontend work, run `pnpm test` unless there is a clear blocker.
