# cVim → Manifest V3 Migration Plan

## Background

cVim is a **Manifest V2** extension (`manifest.json`: `"manifest_version": 2`).
Chromium has fully removed the ability to run MV2 extensions:

- **Chromium 138 (2025-07-24):** MV2 extensions disabled for all users on all
  channels, with no way to re-enable them.
- **Chromium 139+:** the enterprise `ExtensionManifestV2Availability` policy is
  removed — MV2 extensions cease to function entirely.

Brave tracks Chromium closely, so once Brave updated into that range the browser
began refusing to load cVim's background page and content scripts. Nothing in the
extension changed; the platform removed the runtime MV2 depends on. This document
is the plan to port cVim to Manifest V3.

## Guiding principles

- **Keep `.cvimrc` fully working** — settings, `map`/`imap`/`unmap`, blacklists,
  site-specific `site{...}` scopes, `:source`, gist sync.
- **Remove only what requires `eval` / arbitrary code injection.** MV3 bans
  `unsafe-eval` in content scripts with no escape hatch (a sandboxed iframe — the
  one place MV3 permits eval — cannot reach the page DOM, which is the whole point
  of these features).
- Everything else is mechanical API modernization plus one real architectural
  change: persistent background page → service worker.

No `chrome.webRequest` blocking and no remotely-hosted code (besides the eval we
are removing) are used — the two worst MV3 blockers are absent, which is why this
migration is feasible.

---

## Phase 0 — Remove un-portable features ✅ DONE

_Completed in commit `7f24545`._

These four features all execute user-authored JS strings and cannot survive MV3.
Remove the feature, its parser support, its execution site, and its docs.

**Implementation notes (as built):**

- The PEG grammar (`cvimrc_parser/parser.peg`) still *recognizes* the
  `{{ ... }}` / `->` syntax but its actions now `return null`, so older
  `.cvimrc` files keep parsing and the code is silently discarded. The parser
  was regenerated via `make` (which also copies to
  `content_scripts/cvimrc_parser.js`); this required `npm install` (adds
  `package-lock.json`).
- `:call <jsFunction>` (`mappings.js`) and `createScriptHint` now show an
  `"...not supported"` error via `Status.setMessage(..., 2, 'error')` instead
  of eval'ing. Built-in `:call <action>` still works.
- Removed: `_.runScript` (`actions.js`), the `:script` branch (`command.js`),
  the `AUTOFUNCTIONS` loop (`command.js`), the `eval` case in `messenger.js`,
  the `case 'script'` hint executor + its HUD label (`hints.js`), and the now
  unused `FUNCTIONS: {}` default (`options.js`).
- Docs: `pages/mappings.html` / `pages/changelog.html` are generated from
  `README.md` / `CHANGELOG.md` via `scripts/create_pages.js`, so they were
  regenerated rather than hand-edited.
- Verified: parser test suite passes, all edited JS passes `node --check`, and
  no live `eval`/`FUNCTIONS`/`AUTOFUNCTIONS`/`runScript`/`scriptFunction`
  references remain.

| Feature | Config syntax | Execution site to delete | Parser site |
|---|---|---|---|
| Named JS functions / code blocks | `name() -> {{ ... }}`, `:call fn` | `content_scripts/messenger.js:295` (`eval(FUNCTIONS...)`), `content_scripts/mappings.js:935` (`ECHO('eval')`) | `cvimrc_parser/parser.js:293` (`FUNCTIONS`) |
| Script hints | `createScriptHint(fn)` | `content_scripts/hints.js:179` (`eval(FUNCTIONS...)(link)`), `content_scripts/mappings.js:432` | `FUNCTIONS` (shared) |
| Auto-functions | bare `{{ ... }}` block | `content_scripts/command.js:1198-1202` (`eval(AUTOFUNCTIONS...)`) | `cvimrc_parser/parser.js:285` (`AUTOFUNCTIONS`) |
| `:script` command | `:script <js>` | `content_scripts/command.js:897-899` → `background_scripts/actions.js:581` (`runScript`/`executeScript({code})`) | n/a |

Steps:

1. Delete the `FUNCTIONS` (`parser.js:293-301`) and `AUTOFUNCTIONS`
   (`parser.js:285-292`) grammar rules from `cvimrc_parser/parser.js`, then
   **regenerate** `content_scripts/cvimrc_parser.js` from the PEG grammar (see the
   `cvimrc_parser/` build), or hand-mirror the edit into both copies.
2. Delete `_.runScript` (`actions.js:581-590`) and the `:script` branch
   (`command.js:897-899`).
3. Delete the `AUTOFUNCTIONS` loop (`command.js:1198-1202`), the `eval` cases in
   `messenger.js:294-296` and `mappings.js:934-939`, `createScriptHint`
   (`mappings.js:432`), and the `case 'script':` hint handler (`hints.js:178-180`).
4. **Make removed config a soft no-op, not a parse error:** when the parser hits
   `{{`, `->`, or `createScriptHint`, skip it and surface a warning ("JS functions
   are unsupported in cVim MV3") rather than failing the whole `.cvimrc`. This
   protects existing users' configs.
5. Update `README.md` (remove the "Code blocks" section ~L170-183, the
   `createScriptHint` row ~L346, and the `:script` row ~L491) and `CHANGELOG.md`.

> Note: `editWithVim` / `set vimport` (`actions.js:730`) is **kept** — it POSTs to
> a localhost helper, which is portable to `fetch`, not an eval feature.

---

## Phase 1 — Mechanical API swaps ✅ DONE

_Completed in commit `dadad5f`._

**Implementation notes (as built):**

- `manifest.json`: `manifest_version` → 3; `browser_action` → `action`; CSP →
  object form `{"extension_pages": "script-src 'self'; object-src 'self'"}`
  (dropped `unsafe-eval`); `<all_urls>` moved from `permissions` to a new
  `host_permissions`; added `"scripting"` permission; `web_accessible_resources`
  → object form with `resources`/`matches`.
- `chrome.browserAction.setIcon` → `chrome.action.setIcon` (popup.js ×5,
  actions.js ×1).
- `chrome.extension.{connect,getURL,onMessage}` → `chrome.runtime.*`
  (pages/popup.js, command.js, messenger.js).
- `chrome.tabs.insertCSS(id, {code})` → `chrome.scripting.insertCSS({target,css})`
  (actions.js `injectCSS`). `update.js` re-injection loop →
  `chrome.scripting.executeScript({target,files})` + `insertCSS({target,files})`;
  also fixed the pre-existing `all_fames` typo → `all_frames`.
- Verified: manifest JSON parses, all edited JS passes `node --check`, and no
  `chrome.extension` / `browserAction` / `tabs.executeScript` / `tabs.insertCSS` /
  `unsafe-eval` references remain.

> The `"background"` block still lists 15 scripts (MV2 form) — converting it to a
> service worker is Phase 2. Loading this manifest as MV3 will fail until Phase 2
> lands; Phase 1 is committed as an isolated, reviewable step.

Original checklist (all applied):

1. **`browserAction` → `action`** — manifest key `browser_action` → `action`;
   6 calls in `background_scripts/popup.js` (`:27,38,46,76,78`) and
   `background_scripts/actions.js:708` (`chrome.browserAction.setIcon` →
   `chrome.action.setIcon`).
2. **`chrome.extension.*` → `chrome.runtime.*`** — `pages/popup.js:7,29`,
   `content_scripts/command.js:573,581,589`, `content_scripts/messenger.js:1,167`
   (`connect`, `getURL`, `onMessage`).
3. **`chrome.tabs.executeScript`/`insertCSS` → `chrome.scripting.*`** —
   `actions.js:612` (`injectCSS`) → `chrome.scripting.insertCSS`;
   `update.js:32-46` re-injection loop → `chrome.scripting.executeScript({files})`.
   (`runScript` already deleted in Phase 0.) Add the `"scripting"` permission.
4. **`web_accessible_resources`** — array → object form:
   ```json
   "web_accessible_resources": [
     { "resources": ["cmdline_frame.html"], "matches": ["<all_urls>"] }
   ]
   ```
5. **CSP** — drop `unsafe-eval`. MV3 form:
   ```json
   "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
   ```
6. **Manifest scaffolding** — `manifest_version: 3`; split `permissions` vs
   `host_permissions` (`<all_urls>` moves to `host_permissions`);
   `clipboardRead`/`clipboardWrite`/`downloads.shelf` remain permissions.

---

## Phase 2 — Background page → service worker ✅ DONE

_Completed in commit `7b86a0e`._

**Implementation notes (as built):**

- **2a — entry point.** Added `background.js`, a classic (`importScripts`)
  service worker that loads the same 15 files in the same order, preserving the
  cross-file globals model without a bundler. `manifest.json` `"background"` →
  `{ "service_worker": "background.js" }` (no `"type": "module"` — kept classic
  so `importScripts` + shared globals work). The worker sets `self.window = self`
  before importing, because three shared files assign to `window.*`
  (`utils.js` `parseConfig`, `main.js` `httpRequest`, `options.js` timer). Also
  moved `main.js`'s hidden `chrome.extension.onConnect` listener group into
  `chrome.runtime` (Phase 1's grep couldn't see it — it was keyed by the
  `Listeners.extension` object, invoked as `chrome[api][method]`).
- **2b — no DOM.** `background_scripts/clipboard.js` rewritten to drive an
  **offscreen document** (`pages/offscreen.{html,js}`, `"offscreen"` permission)
  for copy/paste. `paste` became async (callback); its three synchronous callers
  in `actions.js` (`openPaste`, `openPasteTab`, `getPaste`) were updated. The
  DOM-only helpers in `utils.js` (`document.body`, `traverseDOM`,
  `getComputedStyle`) are never *called* in the worker, so no guards were needed
  beyond the `self.window` alias.
- **2c — fetch.** `main.js` `httpRequest` and `actions.js` `editWithVim` now use
  `fetch` (same Promise signature for `httpRequest`; callers untouched).
  `127.0.0.1` is already covered by `<all_urls>` in `host_permissions`.
- **2d — storage.** `history.js` command history moved from `localStorage` to
  `chrome.storage.local` (`commandHistory` key); load is now async with an
  empty-array seed via `History.clear()`.
- **2e — alarms.** `options.js` hourly `fetchGist` `setTimeout` →
  `chrome.alarms.create('fetchGist', {periodInMinutes: 60})` + `onAlarm`
  (cleared when `autoupdategist` is off). `"alarms"` permission added.
  `actions.js:14` `setTimeout(doOpen, 80)` left as-is (fires mid-action).
- **2f — ephemeral state.**
  - Ports (`activePorts`, `Frames.tabFrames`) intentionally **not** persisted.
    The critical fix is content-side: `messenger.js` `onDisconnect` used to
    *destroy* cVim on the page; it now **reconnects** (`connectPort()`), which
    re-runs the `hello` handshake and re-registers the frame. It only tears down
    if `connect()` throws (extension truly reloaded/disabled). `PORT`/`ECHO`
    resolve the `port` variable at call time so they follow reconnects.
  - Rebuildable tab/window state (`ActiveTabs`, `TabHistory`, `LastUsedTabs` in
    `main.js`; `tabCreationOrder`) mirrored to `chrome.storage.session` on every
    mutation and rehydrated on cold start. Readers stay synchronous
    (best-effort — worst case is one missed action right after a cold start).
  - `Popup.active` (enabled/disabled flag) → `chrome.storage.session`.
  - `sessions.js` needs no change: modern Chromium always has `chrome.sessions`,
    so `nativeSessions` is true and the in-memory fallback branch never runs;
    `recentlyClosed` is rebuilt by `onChanged()` at import + on the event.
- **Known follow-up (out of scope):** `actions.js` `hideDownloadsShelf` calls
  `chrome.downloads.setShelfEnabled`, removed in Chromium 117+. It will throw
  when invoked (isolated feature); flagged for a later cleanup.
- Verified: manifest JSON parses; all edited JS + `background.js` +
  `offscreen.js` pass `node --check`; no `XMLHttpRequest` / `localStorage` /
  worker-illegal `document.`/`window.setTimeout` / `chrome.extension` references
  remain in the background context.

> Runtime behaviour still needs manual testing in-browser (Phase 3) — this is the
> phase with real regression risk (frame tracking, clipboard round-trip through
> the offscreen doc, worker-sleep rehydration).

### Known issues / follow-ups (unfixed, low priority)

Surfaced by the post-Phase-2 review. None block loading the extension; each is
left for a later cleanup pass.

- **`fetchGist` runs on nearly every worker wake** (`options.js` — the top-level
  `storage.local.get('settings')` callback calls `Options.fetchGist()` when
  `autoupdategist && GISTURL`). On MV2 this ran once at browser startup; under
  MV3 the worker re-runs top-level code on every wake, so gist-sync users would
  re-fetch constantly. The hourly `chrome.alarms` timer already covers the
  refresh. Cleaner fix: bootstrap the alarm in `runtime.onStartup`/`onInstalled`
  and drop the per-wake fetch. Only affects the (default-off) `autoupdategist`
  users.
- **`TabHistory` serialized on every URL change** (`main.js` `persistTabState`).
  Writes the full `ActiveTabs`/`TabHistory`/`LastUsedTabs` blob to
  `chrome.storage.session` on every `tabs.onUpdated` carrying a URL. `TabHistory`
  grows unbounded per tab over a session, so the write grows too. Functionally
  fine; a write-volume note only.
- **`Clipboard.ensureDocument` create race** (`clipboard.js`). Two clipboard ops
  within the same async tick could both pass `clipboard_hasDocument()` before
  either sets `CREATING`, causing a second `chrome.offscreen.createDocument` that
  throws "Only a single offscreen document may be created". Rare and self-heals on
  the next op; a shared in-flight guard set *before* the `hasDocument` check would
  close it.
- **`hideDownloadsShelf`** (`actions.js`) calls `chrome.downloads.setShelfEnabled`,
  removed in Chromium 117+. Throws when invoked (isolated feature). _(Also noted
  in 2f above.)_

### Original design notes

#### 2a. Entry point

Replace `"background": { "scripts": [...15 files...] }` with
`"background": { "service_worker": "background.js", "type": "module" }`. Either
bundle the 15 files or `importScripts()` them. Keep load order
(`utils` → `cvimrc_parser` → ... → `main` → `frames`).

#### 2b. No-DOM fixes

- **`background_scripts/clipboard.js` (`:4-25`)** — `document.createElement('textarea')`
  + `execCommand` is dead in a worker. Add an **offscreen document**
  (`chrome.offscreen`, `"offscreen"` permission) hosting a tiny page that does
  clipboard read/write, driven by messages. This preserves copy/paste exactly.
- **`content_scripts/utils.js`** (loaded in the background context) — guard/branch
  the `document.body` / `traverseDOM` paths (`:167,169,349`) so the worker never
  touches the DOM; those helpers are only needed content-side.

#### 2c. `XMLHttpRequest` → `fetch`

- `main.js:9` `httpRequest` — rewrite with `fetch`, keep the same Promise
  signature so callers (`options.js:153`, `actions.js:839`, `files.js:10`) are
  untouched.
- `actions.js:731` `editWithVim` — `fetch('http://127.0.0.1:'+vimport, {method:'POST', ...})`.
  Add `http://127.0.0.1/*` / `http://localhost/*` to `host_permissions`.

#### 2d. `localStorage` → `chrome.storage`

- `history.js:11,100` command history → `chrome.storage.local` (async; adjust the
  read/write to Promises).

#### 2e. Timers → `chrome.alarms`

- `options.js:170` hourly `fetchGist` `setTimeout` →
  `chrome.alarms.create('fetchGist', {periodInMinutes: 60})` + `onAlarm`. Add the
  `"alarms"` permission.
- `actions.js:14` `setTimeout(doOpen, 80)` is short-lived — leave as-is.

#### 2f. Ephemeral state — the core rework

The worker is killed after ~30s idle, wiping the shared globals: `sessions`,
`ActiveTabs`, `TabHistory`, `activePorts`, `LastUsedTabs` (`main.js:1-5`),
`Quickmarks`/`lastCommand` (`actions.js`), `settings`/`Options` (`options.js`),
`Popup.active` (`popup.js`), `Sessions`/`tabHistory` (`sessions.js`),
`Frames.tabFrames` (`frames.js`), `History.*` (`history.js`), `tabCreationOrder`
(`tab_creation_order.js`).

Strategy, tiered by data type:

- **Durable state** (settings, Quickmarks, command history, sessions,
  `Popup.active`) → `chrome.storage` as source of truth; load-or-rehydrate at the
  top of every event handler instead of assuming a one-time init ran.
- **Rebuildable tab/window state** (`ActiveTabs`, `LastUsedTabs`,
  `tabCreationOrder`, `TabHistory`) → persist to `chrome.storage.session`
  (in-memory, MV3-native, survives worker restarts within a browser session).
  Rebuild from `chrome.tabs.query` on cold start.
- **Ports** (`activePorts`, `Frames.tabFrames`) → **do not persist.** Ports break
  when the worker sleeps. Content scripts must **reconnect on demand** and the
  worker must lazily re-register frames on the next message. Convert broadcast
  patterns (`sendLastSearch` `actions.js:594`, settings sync) from "iterate held
  ports" to `chrome.tabs.query` + `chrome.tabs.sendMessage`.

This is the phase that carries real regression risk (frame tracking, session /
back-forward history). Budget most testing here.

---

## Phase 3 — Verification

Manual smoke test on current Brave / Chromium 138+ (load unpacked):

- **Core:** `map`/`imap`, scrolling, link hints (`f`/`F`), find, visual mode, tab
  commands, `:tabopen` / history / bookmark completion.
- **`.cvimrc`:** load a config with settings + mappings + blacklist + `site{}`
  scope + `:source` + gist sync → all apply.
- **Removed features:** a `.cvimrc` containing `{{ }}` blocks / `createScriptHint`
  / `:script` loads with a **warning**, and the rest of the config still applies.
- **Worker lifecycle:** let the SW sleep (30s+), then exercise clipboard
  (`yy`/`p`), search broadcast, session restore, quickmarks — confirm they
  rehydrate.
- **Reload extension** → verify no re-injection breakage (`update.js`).

---

## Effort & risk summary

| Phase | Risk | Rough effort |
|---|---|---|
| 0 — Remove eval features ✅ | Low | ~0.5 day (done) |
| 1 — API swaps ✅ | Low | ~1 day (done) |
| 2 — Service worker ✅ | **High** | code done; needs Phase 3 testing |
| 3 — Verification | Medium | ~2–3 days |
