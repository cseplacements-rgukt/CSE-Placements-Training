# Final Report — Visual Redesign + Performance Pass

**Scope:** `frontend/` only. Date: Aug 23, 2026.
**Verification:** production build ✅ · vitest 15/15 ✅ · `npm run lint` 0 errors/0 warnings ✅ · `vite preview` serves HTTP 200 with correct title ✅ · initial chunk contains zero references to katex / face-api / tensorflow / webgazer / syntax-highlighter (grep-verified against `dist`) ✅

---

## 1. Tailwind install path & rolldown-vite friction

- **Path used:** Tailwind **v4.3.3** via the official **`@tailwindcss/vite`** plugin (CSS-first `@theme` in `src/index.css`; no `tailwind.config.js`, no PostCSS config).
- **rolldown-vite friction:** none. `@tailwindcss/vite@4.3.3` resolves cleanly against the `vite → npm:rolldown-vite@7.2.5` override; first build after wiring produced correct utilities and content-scanned CSS on the first try. The PostCSS fallback was never needed.

## 2. Migration coverage

**Fully migrated to Tailwind utilities (original CSS file deleted):**

| Pages | Components |
|---|---|
| Login, Dashboard, TakeExam, MySubmissions, CreateExam, ExamDraftWorkspace, ExamSubmissions, QuestionBank, AdminDashboard | Navbar, RichContent, CameraFeed, CalibrationScreen, VideoPlayer, QuestionBankSelector |

**Deleted (17 files):** App.css, old index.css token block, Navbar.css, Auth.css, Dashboard.css, Submissions.css, TakeExam.css, ExamSubmissions.css, AdminDashboard.css, CreateExam.css, ExamDraftWorkspace.css, QuestionBank.css, QuestionBankSelector.css, RichContent.css, CameraFeed.css, CalibrationScreen.css, VideoPlayer.css.

**Left unconverted:** nothing — coverage is ~100%. A few inert semantic class names are deliberately kept as test hooks (`.rich-katex*`, `.rich-inline*`, `.rich-code-fallback`, `.rich-paragraph`, `.camera-video`, `.camera-error`); their styling comes from utilities.

**Shared primitives extracted** (`src/components/ui/`): Button (primary/secondary/ghost/danger/dangerGhost × sm/md/lg, real hover/active/disabled/focus-visible states), Card (+Header/Title/Body/Footer), Badge (success/warning/danger/info/neutral/accent with status dots), Input/Select/Textarea/FileInput (gold focus ring, red border + icon+text errors), Modal (Escape + overlay close + scroll lock), Alert, Spinner/LoadingScreen, Skeleton/SkeletonText, EmptyState, PageHeader, Table primitives, Pagination. Plus `AppLayout` shell, `hooks/useDebouncedValue.js`, `hooks/usePagedData.js`, `lib/faceApi.js`.

**Design tokens** live once in `index.css @theme`: charcoal/gold identity (`primary #292524`, `accent #B45309`, canvas/surface/ink/ink-muted/line), radius sm=8 md=10 lg=12 xl=16, subtle shadows, Inter via `--font-sans`. Type scale enforced via PageHeader (24px/700 titles) and component-level sizes.

## 3. Pages touched

Every page: Login, Dashboard, TakeExam, MySubmissions, CreateExam, ExamDraftWorkspace, ExamSubmissions, QuestionBank, AdminDashboard — plus all shared components listed above, `App.jsx`, `main.jsx` (unchanged actually), `index.html`, `vite.config.js`, `eslint.config.js`. Product naming corrected to "CSE Placements Training" everywhere user-visible (Navbar, Login panels, Dashboard subtitle, admin header, `<title>`); monogram "CP".

## 4. Route splitting & bundle results

| Metric | Before | After | Δ |
|---|---|---|---|
| Initial JS (`index-*.js`) | 1,536 kB / 421.9 kB gzip | **436 kB / 135.3 kB gzip** | **−72% raw / −68% gzip** |
| Initial CSS | 128.9 kB / 26.6 kB gzip | 45.5 kB / 9.3 kB gzip | −65% |
| KaTeX + Prism | in initial bundle | own `RichContent-*` chunk (335.9 kB / 101.9 gzip) | loads only with TakeExam/DraftWorkspace |
| face-api.js (+tfjs `es6-*` 661 kB) | in initial bundle | dynamic via `lib/faceApi.js` | loads only when calibration/face-detection starts |
| webgazer | already lazy (`src-*` 1,370 kB) | unchanged | loads at gaze-tracking start |

**Route-split (React.lazy + Suspense, LoadingScreen fallback):** TakeExam, MySubmissions, CreateExam, ExamDraftWorkspace, ExamSubmissions, AdminDashboard, QuestionBank. **Eager fast path:** Login + Dashboard (student login→dashboard never waits on a route chunk). Note TakeExam is lazy but its heavy deps are *additionally* deferred past mount, so the exam UI itself renders without waiting on tfjs/katex.

**Tailwind purge verified:** initial CSS is 45.5 kB (utilities actually used); no full unpurged stylesheet shipped.

## 5. Lists: pagination vs virtualization

Chose **client-side pagination everywhere** (no virtualization dependency) because data arrives as one array from existing endpoints (no server-pagination API to lean on) and RGUKT-scale lists (200–250 roster rows) are trivially handled at 25/page:
- ExamSubmissions table 25/pg · Admin roster 25/pg · staff table 25/pg · QuestionBank 25/pg · QB-selector modal 20/pg · MySubmissions grid 12/pg.
- `usePagedData` resets to page 1 on filter changes using React's adjust-state-during-render pattern.
- **Debounce:** QuestionBank company filter 400 ms (previously fetched per keystroke), QB-selector search 300 ms, staff search 300 ms, roster search 450 ms debounced server fetch (Enter/Apply still work). Submissions filter is a select → memoized instead.

## 6. Exam interface specifics

- **Timer isolated**: `ExamTimer` ticks in its own state off an `endAt` timestamp; parent only receives milestone alerts (300/60 s, same warnings as before) and a single `timeUp` flag → auto-submit path preserved via latest-ref callback. No per-second re-renders of question/palette/header.
- Question card is `memo`ized on primitive props → face-status ticks don't re-render question content.
- Palette: charcoal=current, green=answered, neutral=unanswered, disabled-forward respected; legend included; no blue anywhere.
- Selected MCQ = light gold tint + gold border; word-count over-limit shown as red text (not color alone).
- No animations inside the exam screen beyond 150–200 ms color transitions; timer pill shifts amber <5 min / red <1 min only.
- KaTeX inline/display/matrix rendering untouched (same tokenizer); `.katex-display` gets overflow-x guard. Cloudinary images now lazy-load inside a reserved 4:3 box (`object-contain`) → zero layout shift.

## 7. Intentionally left untouched (functionality)

Routes/guards, AuthContext & Firebase flows, all services/endpoints, exam scoring/auto-save/proctoring logic (event types, penalties, thresholds, lock/unlock), CSV import semantics, GazeTracker.js, backend. `window.alert/confirm` flows preserved as-is. localStorage keys remain `modugo_*` (invisible to users; renaming would invalidate live sessions).

Minor visual-behavior notes: trust-score "flash" animation dropped (visual noise mid-exam; score still updates live); Sign Out stays under an "Account" nav label as before.

## 8. Where blue appears (and why)

Grep sweep for blue/violet hex values, `blue-*`/`violet`/`indigo` classes across `src`: exactly two hits —
1. `index.css --color-info:#0ea5e9` — the single sanctioned info token. Its only consumers are informational badges/notices: Badge `info` variant ("Ready for Review"), Alert `info` variant (coordinator-notes notice, restricted-note, import summary), password-status info text. Never buttons, nav, focus rings, selected states, or links.
2. Google-logo SVG inside Login's "Continue with Google" button — official third-party brand mark (Google's own four colors incl. #4285F4); not part of our palette.

No violet anywhere. Focus/selected/active states use gold accent or charcoal throughout.

## 9. Items needing sign-off

1. **Question-image letterboxing** — reserved 4:3 box guarantees zero CLS but non-4:3 Cloudinary images letterbox rather than size naturally. Alternative would reintroduce layout shift; happy to switch to natural sizing if preferred.
2. **`test-frontend.js`** (frontend root, stray scratch API script with `require()`) — added to eslint ignores rather than deleted; say the word and I'll remove it.
3. **react-refresh lint rule turned off for `src/pages/**`** so pages can co-locate small row/badge components; AuthContext's pre-existing `useAuth` export got a one-line targeted disable. Both are dev-experience-only settings.
4. **TakeExam still uses `alert()`/`confirm()`** for warnings/submission confirms — preserved behavior by design; replacing them with styled dialogs is a functional UX change I didn't make unilaterally.

---

## 10. Post-report functional changes (user-requested, Aug 23 2026)

### 10.1 JSON bulk-import replaces "From Question Bank" in the draft workspace

Per user request, the collaborative exam builder no longer pulls questions from the shared Question Bank. Instead:

- **New flow:** Build tab → **"+ Import JSON"** → modal shows the exact JSON contract (copyable + downloadable sample) so staff can hand the format to ChatGPT/any AI, get questions generated in that shape, and upload the `.json` (or paste it). Every valid row is added straight into that exam via the existing `addExamQuestion` endpoint — no backend changes.
- **Validation is client-side and strict:** per-row errors (row number + reason) for invalid type, missing question/correctAnswer, mcq answers not matching an option, bad points/wordLimit/difficulty, unsupported code languages, >200 rows. Confirm stays disabled until every row passes.
- **AI-friendly forgiveness:** `true_false` auto-fills `["True","False"]` options if omitted; bare arrays accepted; section names map case-insensitively to existing sections (unknown → Ungrouped); BOM tolerated.
- **Files:** new `src/components/ExamQuestionsJsonImport.jsx` (UI) + `src/lib/examQuestionsImport.js` (pure validator, unit-tested); `QuestionBankSelector.jsx` component deleted; `handleQBSelect` removed from ExamDraftWorkspace.
- **Untouched on purpose:** the standalone `/question-bank` page (still has its own import/manage UI), the manual "+ Add Question" editor, and all backend endpoints.
- **Tests:** 8 new validator tests (23 total passing).

### 10.2 Stitch-seam crash fixes found during QA

- `ExamSubmissions.jsx` / `AdminDashboard.jsx`: restored missing `export default` (broke React.lazy at runtime).
- Missing JSX imports fixed: `memo`+`Suspense` (ExamSubmissions), `Input`/`Select` (AdminDashboard), `CardFooter` (ExamDraftWorkspace).
- Root cause of lint/build silence: `no-undef` doesn't check JSX names without eslint-plugin-react, and Rolldown treats unknown identifiers as globals. A repo-wide audit script now verifies every capitalized JSX element resolves; consider adding `eslint-plugin-react` for permanent coverage.
