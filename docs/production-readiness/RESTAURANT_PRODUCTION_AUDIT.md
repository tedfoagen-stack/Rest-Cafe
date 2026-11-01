# Rest&Cafe — Production Readiness Audit

- **Audited HEAD:** `4743bfd3a9ad92cc754451d57077096a3c17f303` (upstream `main`; the
  assignment commit itself). Work was done on branch
  `assistant/production-readiness-audit` at `9555581168587783f515a0240477dda9e97450e1`,
  which is that commit plus the audit-start announce file only; the audited code
  is identical.
- **Assignment:** thread `20261101-035` (owner-assigned 2026-11-01, relayed
  through Ted). Audit and test plan only — no fixes, no application files.
- **Date of audit:** 2026-11-01. Auditor: Flint (assistant implementation
  agent), with read-only inspection by three parallel reviewers and a targeted
  test battery run on this Linux VM.
- **Target workload (from the assignment):** about 50 tables, 4 waiter tablets,
  1 KDS tablet, 1 kitchen ticket printer, 1 Windows cashier PC as local host,
  1 USB receipt printer on the cashier PC, central SQLite database on the host,
  local Wi-Fi/LAN, concurrent order/payment/transfer/close activity.

## How this audit was done

Phase A (baseline) is code read at the audited HEAD, plus the targeted test
battery listed in the appendix. Nothing was taken on trust from earlier audit
reports or agent summaries: every claim below cites the file and line where it
was read, or a test run executed for this audit with its exact command and
output. Where a claim could not be verified in this environment it is labelled
unverified, not asserted.

Method limits, stated plainly:

- No Windows machine was available in this environment. Installer behaviour,
  the Windows firewall prompt, printer behaviour on real hardware, and
  `flo.local` (mDNS) resolution on the owner's network were not observed.
- No physical printer was available. All printing claims are from code and
  from byte-level suites (receipt-column oracle), not from paper.
- No live multi-device run was performed. Concurrency claims rest on code
  inspection and on the full-house and day-cycle suites, which simulate
  concurrency against one backend process, not on four real tablets.
- The full `npm test` chain (220 segments) was not run end to end in this
  audit. A targeted battery of 36 items was run instead; the appendix lists
  each item and its result. Everything not run is marked NOT RUN, with the
  reason.

Severity meanings used in this report:

- **P0 — pilot blocker:** the pilot cannot start, or a core pilot flow is
  untestable, until this is fixed.
- **P1 — must fix before a real-restaurant pilot:** a real service failure,
  money risk, or data-loss risk under the target workload.
- **P2 — fix before scale, or accept explicitly:** degrades service,
  documentation, or confidence, but does not by itself stop a small pilot.

## 1. Repository architecture as implemented

One Windows PC is the cashier workstation and the local host server. The
Electron app owns startup and shutdown; the backend is Express on port 3001,
a standalone KDS server on port 3002, and a Server App on port 3003. All three
bind `0.0.0.0`. The database is SQLite (`better-sqlite3`) at
`%APPDATA%\RestCafe\flo.db`, opened with WAL, `synchronous = NORMAL`, and
`busy_timeout = 5000`. There is no cloud sync, no telemetry, no updater, and
no internet requirement for normal operations; updates are manual reinstalls
of an unsigned NSIS installer.

Startup order (`main/index.ts`, `initialize()`): database, main API on 3001,
daily local-backup timer, KDS server on 3002, Server App on 3003, mDNS
advertisement (`flo.local`), printer initialisation, IPC registration, then
the window. Any step that throws shows an error box and exits the process
with code 1. The window is never created without a healthy runtime. A
single-instance lock prevents a second copy from running.

The frontend is Next.js, statically exported for desktop. It derives its API
base URL from `window.location.origin`, so a tablet reaches the backend only
through the URL it loaded the page from. Pairing is by QR code / mDNS URL
from `GET /pos-info`. The POS page is a thin composition over hooks
(`usePosCatalog`, `usePosTableWorkspace`, `usePosOrderSubmission`,
`usePosPrinting` and others); KDS has a dashboard view and a standalone view
sharing one workspace component, connected by WebSocket with a REST polling
fallback.

Printing goes through one semantic document model (`shared/print/`) with
classic/compact/KOT/delivery-slip/Z-report renderers and network, CUPS,
Windows-spooler, IPP, and WebUSB transports. The ESC/POS builder is
fail-closed: a financial line the printer cannot represent empties the whole
document instead of printing a bill missing its totals.

Money is backend-authoritative. Orders are never ownership-gated: any role
with order access can see and act on every order. Payments carry
`Idempotency-Key` handling server-side and durable attempt records
client-side. Refunds require a staff-approval PIN (bcrypt hash on the owner
record) and can never exceed paid minus prior refunds. Tax is Off/Manual, with
a Syria consumption-fee profile and manual packs.

## 2. Verified capabilities

These were read in code at the audited HEAD, and the named suites were run
green for this audit unless stated otherwise.

- **Ordered, fail-closed startup.** Database, then the three servers in
  order, then mDNS, printer, IPC, window. A failed step shows an error box
  and exits 1; the window is refused without a healthy runtime
  (`main/index.ts:1155-1290`). Single-instance lock
  (`main/index.ts:375-395`). Relaunch is one-shot per process with a
  cross-restart flag, and a stuck dialog offers a diagnostic report.
- **Fail-closed database guards.** A missing database on a previously
  initialised install throws `ERR_DATABASE_MISSING` instead of silently
  creating an empty database (`main/db/core.ts:556-568`, issue 278 suite
  green). A database newer than the build throws `SchemaVersionMismatchError`.
  Every migration runs in its own transaction with a `user_version` stamp,
  preceded by an automatic pre-migration backup that is itself fail-closed
  (`main/db/migrations.ts:3574-3610`, `3662-3701`). 122 migrations, v1..v122;
  registry suite 371/371 green in this audit.
- **Startup integrity checking on every boot.** `PRAGMA integrity_check` and
  `PRAGMA foreign_key_check` run at every start
  (`main/db/core.ts:646-672`); a failed check sets `dbHealthError`, reported
  by health endpoints.
- **Port-conflict resilience.** Each server bumps to the next port for up to
  10 attempts on `EADDRINUSE`/`EACCES` before failing startup
  (`main/server.ts:406-424`; same pattern on 3002/3003). The POS window
  follows the bumped main port. Suite green.
- **Backup and restore are journalled and undoable.** Online-backup API into
  self-contained files with `_flo_meta` stamps; restore validates
  readability, metadata-vs-pragma match, and version; direct restore is
  journalled with rollback and post-restore integrity/FK checks; a
  pre-restore safety copy (retention 3) makes a wrong restore undoable
  (`main/db/backup.ts:653-790`, `2521-2800`). Backup, restore, and wipe are
  serialised by one maintenance lock. Restore is authenticated
  (`database.manage` plus the typed phrase `RESTORE BACKUP`, or Master PIN
  over IPC). Suites `test:backup` and `test:local-backup` green.
- **Daily local backup.** On by default, to `%USERPROFILE%\Documents\RestCafe\Backups`,
  24-hour cadence, retention 5, skips a database with no business data
  (`main/services/local-backup.ts`).
- **Order, append, and payment idempotency is thorough and fail-closed.**
  Durable, user-scoped attempt records with UUID keys and `x-operation-id`
  correlation; verified-write storage; completion markers; 24-hour append
  expiry; a damaged attempt is never replaced with a fresh key; if attempt
  storage itself fails, the request is not sent
  (`frontend/src/lib/pos/order-attempts.ts`,
  `frontend/src/lib/order-attempt.ts`,
  `frontend/src/hooks/usePosOrderSubmission.ts:747-1056`). Server-side,
  `Idempotency-Key` handling and duplicate-payment refusal live in
  `main/routes/bills.ts` (`preparePaymentBatch`, refusal `bill_already_paid`).
  Suites `test:issue-788-order-attempt-storage`,
  `test:bills-settlement-idempotency` (134/134 per its own record), and
  `test:full-house` green in this audit.
- **Concurrent-rush money safety, as simulated.** The full-house suite (40
  tables at 100% occupancy, three rounds, three-way reconciliation of Reports
  API vs independent SQL vs pinned constants) ran green in this audit:
  0 money mismatches, 1,289 assertions per run, runtime 9.7 s; the
  ten-table bill-and-pay burst measured 104 ms against a 280 ms bound.
  The restaurant day-cycle suite ran green.
- **KDS reconnect and resync.** WebSocket first with REST polling fallback
  (5 s poll, 10 s per-request timeout), exponential reconnect backoff
  (1 s to 30 s), an app-level ping/watchdog that closes zombie sockets after
  45 s without a frame, and a full-snapshot resync on every reconnect
  (`frontend/src/hooks/useKdsConnection.ts`). KDS WebSocket auth is JWT-only
  with revocation and staleness checks and an unauthenticated-client cap
  (`main/services/kds.ts:167-410`). Suites `test:kds-live-push` and
  `test:kds-integration` green.
- **KDS optimistic concurrency.** The frontend always sends `expected_status`;
  both REST (HTTP 409) and WebSocket enforce it atomically
  (`UPDATE … WHERE id = ? AND status = ?`), and the frontend refreshes full
  state on conflict (`main/routes/order-items.ts:103-124`,
  `main/services/kds.ts:441-503`). Terminal item statuses cannot be updated
  on either transport. Order status rollup only ever advances
  (`main/services/order-status-rollup.ts`).
- **Fail-closed receipts.** A financial line that cannot be represented (or
  rasterized) yields an empty buffer, never a bill missing totals
  (`main/printers/formatting-helpers.ts:501, 621, 672`); `printReceipt`
  refuses before dispatch with a clear message
  (`main/printers/thermal.ts:117-120, 289`). Column budgets are measured
  from emitted ESC/POS bytes and pinned per profile in a golden fixture;
  the receipt-column oracle ran green in this audit. Latin digits are forced
  on amounts and KOT times. Catalog text cannot inject ESC/POS commands.
- **Orders and payments survive printer failure.** Printing is post-commit
  and non-fatal on both KDS ticket and receipt paths
  (`frontend/src/hooks/usePosPrinting.ts:37-104`).
- **Per-station KOT routing by category** exists and falls back to the
  default kitchen printer for unrouted items
  (`main/routes/printers.ts:1167-1231`). KOT appends print only the newly
  added items (id-filtered).
- **Layered print fallback in the frontend:** hardware ESC/POS, then WebUSB
  ESC/POS with raster, then system/browser print, with an explicit toast on
  the no-printer fallback (`frontend/src/hooks/usePrinter.ts`).
- **LAN operation needs no internet.** Base URL is `window.location.origin`;
  the backend serves frontend and API from the same host. Suite
  `test:no-external-services` green; `test:offline-mode` green.
- **Authentication and authorisation surface.** JWT lifecycle with
  revocation and staleness checks; role/permission enforcement per endpoint
  with owner-configurable role templates and two protected owner-only
  permissions; PIN brute-force limiting (429, 15 minutes); rate limiting on
  all three servers (general API limiter bypasses private/loopback/Tailscale
  addresses; the auth limiter deliberately does not).
  Suites `test:security`, `test:staff-authz`, `test:orders-authz` green.
- **Money suites green in this audit:** `test:refunds`,
  `test:integration-payments`, `test:integration-order-hold-payment`,
  `test:cash-sessions`, `test:bills-print-api`, `test:menu-printing`,
  `test:sold-out-backend`, `test:syria-tax-profile`,
  `test:tax-pack-switch-atomicity`, `test:cancel-closes-bill`, plus
  `test:cors` and `test:csp-lan`. Lint green; lint budget 969 backend
  warnings against a budget of 1000, 1 frontend warning against 5.
  Backend build (`npm run build`) green.

## 3. Confirmed defects

Each defect has evidence: a file and line read at the audited HEAD, or a
test run executed for this audit. "Confirmed" means the code or the run shows
it; a defect is not downgraded to a risk because a workaround exists.

### P0 — pilot blockers

- **F-001 — The browser/electron end-to-end harness cannot start.**
  `tests/e2e-server.cjs:64-66` requires `../dist/main/services/whatsapp`;
  no `whatsapp` module exists under `main/services/` or `dist/main/services/`
  (verified by direct `require`, which fails `MODULE_NOT_FOUND`). Playwright
  starts this file as its `webServer` (`frontend/playwright.config.ts:15-16`),
  so `test:e2e:server`, `test:e2e:browser` (and tiers), and
  `test:e2e:electron` cannot start at all on this HEAD. The whole 71-spec
  Playwright layer is unrunnable. The breakage is recorded as tech debt in
  the implementation report (follow-up 8) and was never fixed. Impact: no
  automated browser-level verification of any pilot flow (login, POS,
  checkout, KDS, settings) exists until the harness is repaired.
- **F-002 — The full-house suite's timing evidence does not cover real
  tablets.** The burst timings quoted in section 2 (ten-table bill-and-pay
  104 ms) are in-process `Promise.all` calls against one backend, not four
  tablets over Wi-Fi. This is a limit of the evidence, not a code defect,
  and it is listed here because the go/no-go in section 11 rests on it: no
  measurement of the 500 ms p95 API target exists on a real LAN with real
  devices.

### P1 — must fix before a real-restaurant pilot

- **F-003 — No timeout on the shared POS/KDS HTTP client; a hung sale
  blocks the till.** `frontend/src/lib/api.ts` creates its axios instance
  with no `timeout`. Every POS order, payment, append, and bill request, and
  every dashboard-KDS item-status mutation, inherits this. Only the KDS REST
  poll (10 s) and the standalone KDS client (10 s) have timeouts. On a
  half-open connection — a tablet Wi-Fi drop mid-request is the exact
  scenario in the assignment — a `POST /orders` or a KDS status tap can hang
  with the submitting/updating spinner stuck and no failure path taken: the
  failure classification, diagnostics capture, and manual-retry UX never
  run. The only recovery is a reload, which loses the in-memory cart
  (F-011). The codebase itself recognises the hazard for KDS polling and
  applies a ceiling there, but not to the mutations.
- **F-004 — KOT reprint or retry duplicates pending items; no printed
  marker exists.** `isKotItemPending` (`shared/print/document.ts:845-847`)
  includes every item not yet `ready`/`served`, and nothing in the print
  path changes an item's status after a successful KOT print. A retry after
  an ambiguous failure (partial socket write, then timeout — the network
  transport reports no per-byte acknowledgement) or a manual KOT reprint
  re-sends all still-pending items. The only mitigation is in the caller:
  the frontend append path filters to new item ids. A busy kitchen can
  therefore receive the same ticket twice with no way to tell the duplicate
  from a genuine new ticket.
- **F-005 — No autostart after Windows restart.** A repo-wide search for
  `setLoginItemSettings` / `autoLaunch` returns nothing: no login-item
  registration, no Startup-folder shortcut, no Windows service. After a
  Windows restart, power cut, or Windows Update reboot, the POS does not
  start by itself; someone must launch it manually. The NSIS installer does
  create desktop and Start-menu shortcuts, but nothing launches the app on
  login. For a restaurant POS this is a production-readiness gap.
- **F-006 — Port bump is silent to LAN clients.** On `EADDRINUSE`/`EACCES`
  each server logs the bump to the console only and tries the next port
  (`main/server.ts:406-424`). The POS window follows the bumped main port,
  but a KDS tablet, server-app phone, or bookmarked URL using the default
  port fails to connect with no operator-facing notice. The About dialog
  shows the live ports, but nothing tells the operator the port moved.
- **F-007 — No off-host backup exists.** Google Drive backup was removed end
  to end (`docs/architecture/cloud-integrations.md:22-24`). The only ways a
  backup leaves the host PC are manual file copying out of
  `%APPDATA%\RestCafe\backups` or `%USERPROFILE%\Documents\RestCafe\Backups`,
  or the `GET /api/db/download` route. There is no scheduled off-site copy
  and no documented off-site routine. A host-PC failure (disk, theft, fire)
  with no manual copy means total data loss. The daily local backup and the
  manual backups both live on the same disk as the live database.
- **F-008 — The Z-print path has no passing automated check.**
  `test:cash-closures` section 15 (Z print with forced drawer pulse) fails
  in this audit exactly as independently reproduced before on pristine main:
  owner `POST /:id/print` returns 502 `ECONNREFUSED 127.0.0.1:9100`, three
  assertions fail, and the suite crashes at
  `tests/cash-closures.test.ts:1694`. Sections 1–14 of the suite pass. The
  failure is a test-harness gap (no printer listens on 9100 in this
  environment, and the mock does not intercept this path), not proof that
  Z-printing is broken on real hardware — but it is also not proof that it
  works. Day-close printing is a pilot-critical flow and its only automated
  check is red.
- **F-009 — A failed KOT or receipt is lost until manual reprint; there is
  no retry queue.** No print queue, retry table, or pending-print store
  exists anywhere in `main/` or the migrations. The only recovery is the
  operator following the `saleCompleteReprintNextStep` hint. A busy service
  that misses the toast has no automatic catch-up; the KDS screen is the
  only backstop, and only if staff look at it. Combined with F-004, a
  failed-then-retried KOT can also duplicate.
- **F-010 — CI does not run the suites that protect this system, and the
  E2E jobs the tooling cites do not exist.** `.github/workflows/ci.yml`
  runs lint, both builds, and 7 focused suites only
  (`test:url-allowlist`, `test:offline-mode`, `test:first-run`,
  `test:tax-pack-catalog`, `test:electron-api-contract`,
  `test:print-parity`, `test:script-coverage`). No backup, migration,
  upgrade, startup, full-house, day-cycle, or receipt-oracle suite runs in
  CI, and `npm test` itself is never run in CI — `test:script-coverage`
  only proves suites are wired, not that they pass. The validator's
  `TEST_EXCLUSIONS` justify excluding the E2E scripts with "runs in the
  dedicated Playwright CI job", but no such job exists: the workflows
  directory contains only `ci.yml` and `build-windows.yml`, neither mentions
  Playwright. The only Windows job builds the installer and runs zero
  tests. A regression in backup, restore, migration, or startup can land
  on `main` with CI green.

### P2 — fix before scale, or accept explicitly

- **F-011 — The POS cart is in-memory only.** `frontend/src/store/cart.ts`
  uses no persistence middleware (only `pos-settings.ts` persists). The 401
  handler in `frontend/src/lib/api.ts` does a full navigation to
  `/auth/login`, which discards the cart. A token expiring mid-shift, a
  reload during a hung request (F-003), or a crash loses the items the
  cashier already rang up, with no draft recovery. Held orders survive
  (server-side); the current cart does not.
- **F-012 — The POS catalog loads once with no retry.**
  `frontend/src/hooks/usePosCatalog.ts:121-167` fetches on mount only; any
  failure shows a toast and leaves an empty product grid. If the backend is
  still starting or the tablet joins Wi-Fi a second late, the cashier must
  reload the page manually. The KDS enabled-check retries 12 times every
  5 seconds for exactly this reason; the POS has no equivalent.
- **F-013 — KDS status progression is not enforced.** The backend validates
  only membership in `pending, preparing, ready, served`
  (`main/routes/order-items.ts:103-124`; `main/services/kds.ts:453-470`). A
  jump `pending` to `served` or a regression `ready` to `pending` is
  accepted if the caller is authorised. The kanban drag confirms only
  forward skips; backward drags need no confirmation; the item modal offers
  direct jumps. The two views disagree, and whether skipping is intended
  flexibility or a defect is undocumented.
- **F-014 — No offline detection or offline queue in the POS.** No
  `online`/`offline` listener exists in `frontend/src`; `navigator.onLine`
  is used only to label a failure after the fact. There is no queued outbox
  for orders or payments and no automatic retry when connectivity returns.
  The cashier must notice the error banner and retry manually, and the POS
  shows no persistent offline indicator (unlike KDS, which shows a red
  disconnected dot). Combined with F-003 and F-012, a Wi-Fi drop during
  service degrades to silent staleness until the next attempted mutation.
- **F-015 — 80 mm width divergence between the two render paths.**
  Frontend 80 mm renders 42 columns; backend Epson/Xprinter profiles render
  48 (golden fixture). The oracle asserts 58 mm agreement only and defers
  the 80 mm decision (`tests/receipt-column-oracle.test.ts:400-446`). The
  same physical printer gets different-width receipts depending on whether
  the job went through the backend or the WebUSB frontend path.
- **F-016 — KOT truncates long item names, addons, and notes instead of
  wrapping.** `document-kot.ts` truncates the item name, addons, and special
  instructions to the column budget. Two products sharing a long prefix
  become indistinguishable on the ticket, and a long instruction can lose
  its operative tail. The receipt path wraps instead.
- **F-017 — Unrepresentable non-financial lines are dropped from the
  printed receipt.** Only a `PrintWarning` (surfaced as a toast) records it.
  For `pack`/`merchant` templates raster is forced off, so an Arabic product
  name on a Latin printer vanishes from the bill while the totals print:
  financially complete but item-incomplete.
- **F-018 — Frontend compact 80 mm widest line is 56 cells against a
  42-column rule** (golden fixture). This is double-width lines by design,
  and the oracle's no-overflow test covers font-A single-size lines only, so
  it passes by construction — but nothing asserts the double-width content
  still fits the paper.
- **F-019 — Exit-code-77 silent skip in the test wrapper.**
  `scripts/run-test.cjs` treats exit 77 as success ("ABI-mismatch skip").
  Any suite exiting 77 for another reason would pass silently inside
  `npm test`. No suite was observed exiting 77 in this audit.
- **F-020 — The default browser run excludes `FINDING:`-tagged tests.**
  `test:e2e:browser` passes `--grep-invert` excluding `FINDING:` (and the
  tier tags). Tests deliberately tagged as findings do not run in the
  default browser pass. (Moot until F-001 is fixed, since the harness
  cannot start at all.)
- **F-021 — Documentation drift in three places.**
  `docs/architecture/runtime-and-lifecycle.md` lists `cloudSync`, `telemetry`,
  and `googleDrive` startup steps and an auto-updater step that do not exist
  in code (`main/index.ts:1166`, `1195-1196`).
  `docs/architecture/data-and-migrations.md` still says the pre-migration
  backup is named `flo-backup-*` (code writes `rest-cafe-backup-*`), still
  calls `main/db.ts` "large" (it is a 150-line barrel since Stage 2), and
  says the daily backup lives in `Documents/FloCafe/Backups` (code writes
  `Documents/RestCafe/Backups`). An operator following the docs would look
  in the wrong folder.
- **F-022 — No restore-onto-clean-host runbook.**
  `docs/maintainers/upgrade-testing.md` contains no restore, clean-host, or
  new-machine procedure. The mechanism exists (install, copy a backup file,
  Settings restore), but there is no written runbook, no stated expectation
  for which settings and users survive, and no tested record of a clean-host
  restore. Separately unverified: `restoreBackup()` merges live-DB security
  state over the restored file; on a fresh install the live state is empty,
  and whether the backup's owner account survives that merge was not traced.
- **F-023 — No firewall or LAN documentation.** A search for "firewall"
  across `docs/` and `README.md` returns nothing, while all three servers
  bind `0.0.0.0`. The first run on Windows triggers a Windows Firewall
  prompt, and KDS tablets depend on LAN reachability, but no firewall rule,
  LAN setup note, or restart-after-reboot procedure is documented.
- **F-024 — Unsigned installer (known, documented).** The NSIS installer is
  unsigned; Windows SmartScreen warns on first run until a code-signing
  certificate is adopted (`docs/maintainers/releases.md:17-19`). This is a
  known phase-1 state, not a surprise — it is listed here so the pilot plan
  includes the SmartScreen step for the operator.
- **F-025 — Lint budget headroom is 31 warnings.** Backend warnings stand
  at 969 against a budget of 1000 (frontend 1 against 5), measured in this
  audit. New code can breach the budget with a small number of new warnings.
- **F-026 — `printed_at` records a print request, not paper output.**
  `POST /api/bills/:id/print` and `markPrinted` set `bills.printed_at`
  without moving bytes. Whether the frontend calls these only after a
  successful physical print was not traced; reports could overstate printed
  bills.
- **F-027 — WebUSB selection is silently empty with several webusb
  printers.** `usePrinter.ts` selects a webusb printer only when exactly
  one exists; with two, the WebUSB path silently has no printer and falls
  through to browser print without naming the cause.
- **F-028 — A stale postpaid attempt is never auto-recovered or surfaced.**
  Only appends have mount-time replay. A postpaid create attempt whose
  response was lost sits in storage until the same cart is placed again. A
  cashier who rings a different cart next is never told the earlier attempt
  exists. The duplicate is still prevented, so this is a visibility risk,
  not a money risk.
- **F-029 — Orders arriving during a KDS outage never chime.**
  `useNewOrderAlert` seeds its seen-set from the first post-reconnect
  snapshot, so an order created while the board was down is silently
  already-there. The code prioritises no false chimes over catching up; a
  kitchen could miss a ticket that arrived during a short outage.
- **F-030 — A LAN IP change strands bookmarked tablets.** No client-side
  re-discovery exists; pairing is a one-time QR/mDNS URL. If DHCP reassigns
  the host IP, tablets on the old IP URL fail until re-paired. `flo.local`
  mitigates this only where mDNS resolves, which was not verified on the
  tablets actually deployed.

### API, concurrency, and security findings

These were verified by reading the API, auth, and concurrency code at the
audited HEAD.

**Verified strong:**

- **Complete auth lifecycle.** JWT login/refresh/logout, revocation (SHA-256
  hash in `revoked_tokens` plus an in-memory set), `tokens_valid_after`
  invalidation on password/PIN change, 24-hour / 10-day expiry, DB-
  authoritative roles (the JWT role claim is overwritten from the database),
  30-second auth cache with fresh reads on KDS paths
  (`main/routes/auth.ts`, `main/middleware/security.ts:275-470`).
- **Permission enforcement is server-side and per-endpoint.** About 60
  permission IDs with shipped role defaults; `authorization.manage` and
  `staff.privileged.manage` are owner-only by a protected rule; guards
  prevent stranding the store without an administrator. Money actions
  (`payments.take`, `bills.*`, `refunds.*`, `orders.discount.apply`,
  `cash.*`) exclude the `server` role in the shipped defaults, so a waiter
  cannot take payments, apply discounts, or issue refunds. Item cancel and
  restore enforce permissions inside their handlers even though they carry
  no route-level guard. No unguarded money endpoint was found.
- **Three-layer duplicate-payment protection.** `Idempotency-Key` with
  stored-response replay checked inside the transaction, an in-memory
  in-flight map serialising concurrent retries with the same key, and
  `payment_transaction_refs` rejecting reused card references (409).
  Balance and state guards in `preparePaymentBatch` reject payments on
  cancelled, refunded, or paid bills (`main/routes/bills.ts:3054-3300`).
- **Order, append, and refund idempotency** via dedicated tables with
  request-hash conflict detection (409 on key reuse with a different body).
  Item edits carry optimistic locking (`expected_edit_version`).
- **All money writes are transactional** (`withTxn`; 16 call sites in
  `main/routes/orders.ts`, 7 in `main/routes/bills.ts`), on WAL with a 5
  second busy timeout. Split and merge validate state inside the
  transaction; merge rejects discounts and split checks.
- **KDS is authenticated, re-authorised every 30 seconds, station and
  category scoped, and re-syncs by full snapshot on every
  (re)authentication** (`main/services/kds.ts`). Unauthenticated sockets
  must send an `auth` JWT within 5 seconds. Caps: 100 KDS clients, 25
  unauthenticated.
- **Cash integrity.** One expected-cash formula is shared by session close
  and day close; variance is recorded; the Z snapshot is stored immutably;
  cash refunds require an open shift.
- **Audit attribution.** `order_audit_log` records actor, action, and
  details for voids, cancels, refunds, discounts, edits, and kitchen
  overrides. Staff list responses never return password or PIN hashes
  (`STAFF_SELECT_FIELDS`).

**Confirmed defects:**

- **F-031 (P2) — The global API rate limit is disabled for exactly the
  clients that use the API.** `main/server.ts:221-231` applies
  `express-rate-limit` (100 requests per minute) with `skip` for any
  private/LAN IP. The same skip exists for static routes. Any LAN device —
  a malfunctioning tablet in a retry loop, or a malicious device on the
  restaurant Wi-Fi — can flood the API without limit. The auth, PIN, and
  order-write buckets still apply, so the money paths keep their own
  limits, but the general API (order create, reads, KDS feed) has no LAN
  limit. The limit is effectively off in production, where every client is
  on the LAN.
- **F-032 (P2) — Account passwords may be only 4 characters.**
  `shared/password-policy.ts`: `PASSWORD_MIN_LENGTH = 4`, no complexity
  requirement. Mitigated by the 5-failed-attempts per 15-minute IP lockout
  and by LAN-only exposure, but a 4-digit password is guessable over time,
  and the same policy gates the owner account that can change permissions
  and export the database.
- **F-033 (P2) — No expiry or cleanup for idempotency records.** No
  `DELETE` against `payment_idempotency`, `order_idempotency`, or
  `refund_idempotency` exists in `main/`, and the tables carry no TTL.
  One row accumulates per keyed order, payment, and refund forever, and a
  key can never be reused even years later. Low severity on a single-store
  database, but unbounded.

**Risks found in this area (unverified, need follow-up):**

- **R-A1 — The audit log is attribution, not forensic integrity.**
  `order_audit_log` is a plain `INSERT` with no hash chain, signature, or
  constraint preventing `UPDATE`/`DELETE`. Anyone with write access to the
  SQLite file can alter history.
- **R-A2 — JWT in `localStorage` plus `unsafe-inline` CSP.** The token is
  kept in `localStorage` (`frontend/src/store/auth.ts:52`), readable by any
  script running in the renderer, while the CSP allows inline scripts
  (`main/server.ts:236-240`, `main/csp.ts`). An XSS flaw would expose the
  token. No XSS was found; the combination raises the impact of any future
  one.
- **R-A3 — Two waiters racing a status change get last-writer-wins with no
  conflict signal.** Status transitions, appends, and discounts re-read
  current state inside `withTxn` and serialise, so no write is lost — but
  there is no user-visible conflict warning when two waiters race the same
  order's status. (Item edits do have optimistic locking; status changes
  do not.)
- **R-A4 — Self-order token travels in the URL query string**
  (`frontend/src/app/self-order/page.tsx:188`). Query strings can land in
  server logs. Token entropy, expiry, and revocation were not verified.
- **R-A5 — KDS snapshot race.** Broadcasts are coalesced and events are
  not queued server-side; a reconnecting KDS re-reads current state, so it
  cannot miss tickets, but intermediate transitions during a disconnect are
  never delivered. No sequence numbers or event log exist.
- **R-A6 — Idempotency-table migration state on real installs.** The code
  queries the scoped `payment_idempotency` table; whether a production
  database has completed the migration that creates it was not checked
  against a real database.

### Financial-policy decisions (owner-ruled, not defects)

These behaviours are recorded owner decisions (assignment 035, locked
decisions section; follow-ups 30–31). They are listed here so they are not
mistaken for defects:

- Item refund defaults to the line total including its consumption-fee share
  (verified in `main/services/refund.ts:249-258` and pinned in the
  full-house suite: tea 10,000 + 1,000 fee = 11,000).
- Cancelling an order that already has collected amounts stays allowed with
  a manager PIN; the partially-paid bill deliberately stays live (verified
  in `main/routes/orders.ts:3176-3354`: the cancel closes only unpaid,
  never-paid bills in the same transaction).
- A no-amount duplicate payment on a bill settled by a mix of discount and
  payment returns 200 no-op (verified in `main/routes/bills.ts:3260-3290`;
  no money moves). A duplicate on a bill paid fully in money is refused
  (400).
- Local-only product: no cloud sync, no telemetry, no updater, no internet
  requirement for normal operations.
- UI languages ar/en only; currencies SYP/USD only in pickers; other
  catalogues and currencies are frozen or dormant by design.
- The single-Windows-host architecture is itself a fixed owner decision.

## 4. Capabilities that exist but are not adequately tested

- **The whole browser/electron end-to-end layer (71 Playwright specs).**
  Exists as files (33,497 lines under `frontend/e2e/`), but the harness
  cannot start (F-001), so none of it has run on this HEAD. This includes
  the login, POS, checkout, KDS, and settings flows a pilot depends on.
- **The full `npm test` chain.** 261 of 269 test scripts are reachable from
  `npm test`/`pretest` by static closure, and 309 of 310 suite files are
  referenced by a reachable script — but the chain itself is never run in CI
  (F-010), and this audit ran a targeted 36-item battery, not the 220-segment
  chain. Whether the full chain is green on this HEAD is unknown; the only
  documented red inside it is cash-closures section 15 (F-008).
- **Real-hardware printing.** USB receipt printing, network ESC/POS,
  kitchen ticket printing, Arabic shaping on Xprinter/Epson hardware, RTL
  rendering, and the cash-drawer pulse have no passing hardware verification
  on record. The receipt-column oracle pins emitted bytes; it does not prove
  paper comes out correctly. The implementation report repeats that physical
  printer verification on the owner's machine is still outstanding.
- **Windows-actual behaviour.** The installer, first install, upgrade
  install, Windows restart, firewall prompt, and database location on a real
  Windows host have no run record in this environment. The installer was
  built successfully from the 033 head (workflow run 41213831486), but the
  owner's trial on his machine is the closure signal and has not been
  recorded as done.
- **Restore onto a replacement host.** The mechanism exists and the
  backup/restore suites pass, but no clean-host restore has been run or
  documented (F-022), and the security-state merge semantics on a fresh
  install are unverified.
- **Concurrency on real devices.** Four tablets plus KDS concurrently has
  been simulated in-process (full-house) but never measured over Wi-Fi with
  real devices. The 500 ms p95 API target has no measurement on a real LAN.
- **KDS behaviour under real network faults.** Reconnect, backoff, watchdog,
  and snapshot resync are verified in code and in unit suites, but no
  router-restart, host-IP-change, or minutes-long outage drill has been run
  against a live board.
- **Capacity targets.** No load run exists for 50 configured tables, 100+
  active order items, or sustained concurrent use. The full-house suite runs
  40 tables in-process; the day-cycle suite runs a two-round day. Neither is
  a capacity measurement.
- **The 8 test scripts outside the main chain** (all e2e scripts plus the
  `test:upgrade-regression` and `test:currency-split` aliases) run nowhere
  automatically. The `test:db-audit` suite runs only via `npm run audit:db`.

## 5. Potential risks that require further investigation

- **R-01 — Integrity-check failure is silent to the operator.** A database
  that fails `integrity_check` still boots the POS (`main/db/core.ts:646-672`,
  "never throws — DB stays available even if dirty"). The flag is exposed
  through health endpoints, but whether any UI surface warns the operator
  was not verified. An operator could keep selling on a corrupt database.
- **R-02 — Shutdown WAL durability.** `closeDatabase()` is a plain
  `db.close()` with no explicit `wal_checkpoint` at shutdown. Whether the
  final close reliably checkpoints the WAL on Windows was not verified.
  Recovery after forced termination or unexpected Windows shutdown is
  therefore unproven, though WAL + `synchronous = NORMAL` is the standard
  design.
- **R-03 — KDS window on a bumped KDS port.** The main POS window follows a
  bumped main port, but whether the KDS window URL follows a bumped KDS
  port was not traced (see F-006).
- **R-04 — `flo.local` (mDNS) resolution on the owner's network.** Pairing
  depends on it as the stable address; whether it resolves on the tablets
  actually deployed was not verified.
- **R-05 — Zero-length print dispatch.** The fail-closed guarantee depends
  on the `warnings` array being threaded through the raster path. No caller
  dropping warnings was found, but the raster path was not fully traced; a
  dropped warnings array could dispatch a 0-byte buffer that the network
  transport would report as success.
- **R-06 — Partial KOT delivery is undetectable.** The network transport
  reports success once the socket accepts the bytes; a printer that jams
  mid-ticket still yields success. No acknowledgement or reprint-on-partial
  mechanism exists.
- **R-07 — KDS snapshot race and chime gap.** See R-A5 and F-029: no
  sequence numbers, no event log; orders arriving during an outage never
  chime on reconnect.
- **R-08 — Stale multi-terminal state.** Tables poll every 10 seconds, the
  POS order alert every 20 seconds, and the POS catalog never re-fetches
  after mount. Two terminals can disagree about table occupancy and
  sold-out state for a poll interval (or indefinitely for the catalog).
  Backend guards are the safety net; they were not all traced in this
  audit.
- **R-09 — Lint budget headroom.** See F-025: 31 warnings of headroom.
- **R-10 — The `dist/` tree in the repo was rebuilt during this audit.**
  `npm run build` ran green here; whether the checked-in `dist/` matched a
  fresh build before this audit was not compared.

## 6. Missing operational procedures

None of these exist as written procedures in `docs/` at the audited HEAD:

- **Restart after Windows reboot / power cut / Windows Update.** No
  procedure, and no autostart exists to make one unnecessary (F-005).
- **Firewall and LAN setup.** No firewall rule, no port list for the
  operator, no static-IP or DHCP-reservation procedure (F-023, F-030).
- **Off-site backup routine.** No scheduled or documented way to get a
  backup off the host PC (F-007).
- **Restore onto a replacement host.** No runbook (F-022).
- **What to do when the cashier PC fails completely.** No procedure; the
  host holds the only database copy unless the operator copied backups out.
- **Printer failure during service.** No written drill for a failed KOT or
  receipt printer (F-009); the only recovery is manual reprint from a toast.
- **Day-close failure.** No procedure for a failed Z-print (F-008) or for
  closing the day when the printer is down.
- **Token/PIN recovery for staff.** Password policy and recovery exist in
  code; no operator-facing procedure was found in `docs/`.
- **Upgrade procedure for the operator.** The maintainer release doc covers
  producing the installer; no operator procedure covers installing the
  upgrade, verifying the database survived, and rolling back.

## 7. Prioritized findings

### P0 — pilot blockers

| ID | Finding |
|---|---|
| F-001 | Browser/electron end-to-end harness cannot start (deleted WhatsApp module required by `tests/e2e-server.cjs`) |
| F-002 | No measurement of the 500 ms p95 API target or the target workload on real devices over a real LAN |

### P1 — must fix before a real-restaurant pilot

| ID | Finding |
|---|---|
| F-003 | No timeout on the shared POS/KDS HTTP client; a hung sale blocks the till |
| F-004 | KOT reprint/retry duplicates pending items; no printed marker |
| F-005 | No autostart after Windows restart |
| F-006 | Port bump is silent to LAN clients |
| F-007 | No off-host backup exists |
| F-008 | Z-print path has no passing automated check (cash-closures section 15 red) |
| F-009 | Failed KOT/receipt lost until manual reprint; no retry queue |
| F-010 | CI does not run the protecting suites; cited E2E jobs do not exist |

### P2 — fix before scale, or accept explicitly

| ID | Finding |
|---|---|
| F-011 | POS cart is in-memory only |
| F-012 | POS catalog loads once with no retry |
| F-013 | KDS status progression unenforced |
| F-014 | No offline detection or offline queue in POS |
| F-015 | 80 mm width divergence between render paths |
| F-016 | KOT truncates long names, addons, notes |
| F-017 | Unrepresentable non-financial lines dropped from receipts |
| F-018 | Frontend compact 80 mm widest line 56 cells vs 42-column rule |
| F-019 | Exit-code-77 silent skip in the test wrapper |
| F-020 | Default browser run excludes `FINDING:`-tagged tests |
| F-021 | Documentation drift (startup list, backup names and folders, `main/db.ts`) |
| F-022 | No restore-onto-clean-host runbook; merge semantics unverified |
| F-023 | No firewall or LAN documentation |
| F-024 | Unsigned installer (known, documented) |
| F-025 | Lint budget headroom is 31 warnings |
| F-026 | `printed_at` records a print request, not paper output |
| F-027 | WebUSB selection silently empty with several webusb printers |
| F-028 | Stale postpaid attempt never auto-recovered or surfaced |
| F-029 | Orders arriving during a KDS outage never chime |
| F-030 | LAN IP change strands bookmarked tablets |
| F-031 | Global API rate limit disabled for LAN clients |
| F-032 | Account passwords may be only 4 characters |
| F-033 | No expiry or cleanup for idempotency records |

## 8. Recommended remediation order

1. **Repair the end-to-end harness (F-001).** Remove or stub the deleted
   WhatsApp require in `tests/e2e-server.cjs` so Playwright can start; then
   run the browser tiers and record the result. Nothing else in the
   browser layer can be verified until this is done.
2. **Fix the hung-sale path (F-003, F-011, F-012, F-014).** Add a request
   timeout to the shared API client (with the same ceiling the KDS poll
   already uses); persist the POS cart draft; retry the catalog load; add a
   persistent offline indicator. These four are one work item: the POS
   surviving a Wi-Fi drop.
3. **Fix the KOT duplicate and loss path (F-004, F-009).** Record a printed
   marker per KOT (or filter by a printed-at watermark) and add a pending
   print queue with automatic retry, so a failed ticket is neither lost nor
   duplicated.
4. **Make the pilot operable (F-005, F-006, F-023, F-007).** Add Windows
   autostart (or a documented Startup-folder step); surface a port bump to
   the operator and in the About dialog; write the firewall and LAN setup
   note; add a scheduled off-host backup copy (even a documented manual
   routine with a checklist is a first step; an automated copy is better).
5. **Close the CI gap (F-010, F-019, F-020).** Run the full `npm test`
   chain in CI (or at least the money, backup, migration, startup, and
   oracle suites), create the Playwright CI job the validator cites or
   remove the citation, and make exit 77 fail loudly. Until CI runs the
   protecting suites, every landing is unverified by automation.
6. **Prove Z-print on real hardware (F-008).** Fix or replace the section
   15 mock so the suite passes in CI, and run a Z-print on the owner's real
   printer as part of the pilot checklist.
7. **KDS progression and chime (F-013, F-029).** Decide as a product
   question whether stage skipping is allowed; enforce the decision
   server-side or document it; decide whether reconnect should chime for
   orders that arrived during the outage.
8. **Harden the LAN (F-031, F-032, R-A1, R-A2).** Apply a LAN rate limit
   instead of skipping; raise the password minimum with a migration path;
   record the audit-log and token-storage limits as accepted risks or fix
   them (hash-chained log; httpOnly token storage is not available in this
   static-export architecture, so document the accepted risk).
9. **Procedures and docs (F-021, F-022, section 6).** Write the restart,
   firewall, off-site backup, replacement-host restore, host-failure, and
   upgrade runbooks; fix the three drifted doc pages; add the two new audit
   pages to the docs index when they land.
10. **Print polish (F-015, F-016, F-017, F-018, F-026, F-027).** Decide the
    80 mm width; wrap KOT lines instead of truncating; surface dropped
    lines; record `printed_at` only on confirmed dispatch.

## 9. Go / no-go recommendation

**NO-GO for a real-restaurant pilot today — conditional, not permanent.**

The core money engine is strong: idempotency, transactions, refunds, cash
closure, and the fail-closed database and receipt paths are well built and
well tested in-process, and the targeted battery in this audit ran 35 of 36
items green. The single-Windows-host architecture is viable for the target
workload on paper: one process owns the database, the services start in a
fail-closed order, and the KDS reconnect design is sound.

But a pilot is a real restaurant, not a test process, and three things block
it:

1. **Nothing browser-level has been verified.** The end-to-end harness
   cannot start (F-001), so no automated check of login, POS, checkout, or
   KDS in a browser exists on this HEAD, and CI runs only 7 focused suites
   (F-010). The pilot would be the first real test of the flows customers
   actually touch.
2. **A hung sale can block the till with no recovery.** No request timeout
   (F-003) plus an in-memory cart (F-011) means a Wi-Fi drop mid-sale can
   leave the cashier stuck with a spinner and, after a reload, an empty
   cart. This is the single most likely pilot-day failure.
3. **The kitchen ticket path can lose or duplicate tickets.** No retry
   queue (F-009) and no printed marker (F-004) mean a failed KOT is lost
   until someone notices, and a retried one can print twice.

Fix the first three sequence items (harness, hung-sale path, KOT
duplicate/loss), add autostart and an off-host backup routine, and run the
pilot checklist in the test matrix (including a real-printer pass and a
four-tablet Wi-Fi drill on the owner's hardware). Then the recommendation
becomes a conditional GO for a small pilot with the P2 list accepted in
writing. Until then, the honest answer is no-go: the system is close, and
the remaining work is measured in days of focused fixes, not a redesign.

## Appendix — tests executed for this audit

Environment: this Linux VM, repo at the audited HEAD, branch
`assistant/production-readiness-audit`. Suites were run serially, one at a
time, with `npm run clean` between suites and proxy variables unset, except
`build:frontend` which ran with the normal environment (it needs the proxy
for Google Fonts). Logs are kept outside the repo under
`~/workspace/rest-cafe-docs/production-audit-20261101/logs/`; the runner
script is `run-audit-tests.sh` in the same directory. Commands below are the
`npm run` script names; each maps to its command in `package.json`.

| Command | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS | 1 warning, 0 errors (frontend); backend lint green |
| `npm run lint:budget` | PASS | Backend 969 warnings (budget 1000); frontend 1 (budget 5) |
| `test:smoke` | PASS | Dual-server smoke passed |
| `test:server-port-collision` | PASS | Port-collision and EACCES fallback passed |
| `test:issue-278-fail-closed-db` | PASS | Fail-closed missing-database tests passed; integrity ok, FK clean |
| `test:backup` | PASS | Restore-from-file API and authorisation passed |
| `test:local-backup` | PASS | Local backup tests passed |
| `test:offline-mode` | PASS | 14/14 passed |
| `test:security` | PASS | Case-variant API paths gated identically |
| `test:staff-authz` | PASS | 69/69 passed |
| `test:orders-authz` | PASS | Order-write rate-limit tests passed |
| `test:kds-live-push` | PASS | KDS live push passed |
| `test:kds-integration` | PASS | KDS integration and auth role contract passed |
| `test:full-house` | PASS | Findings 0, runtime 9.7 s; ten-table bill-and-pay burst 104 ms vs 280 ms bound |
| `test:restaurant-day-cycle` | PASS | 116/116 passed |
| `test:cash-closures` | FAIL | Section 15 Z-print only: owner print returns 502 `ECONNREFUSED 127.0.0.1:9100`, 3 assertions fail, crash at `tests/cash-closures.test.ts:1694`. Sections 1–14 pass. Pre-existing, independently reproduced before on pristine main. |
| `test:cash-sessions` | PASS | 208/208 passed |
| `test:refunds` | PASS | 40/40 passed |
| `test:bills-settlement-idempotency` | PASS | 134/134 passed |
| `test:integration-payments` | PASS | 11/11 passed |
| `test:integration-order-hold-payment` | PASS | 87/87 passed |
| `test:receipt-column-oracle` | PASS | fail 0, skipped 0 |
| `test:bills-print-api` | PASS | 34/34 passed |
| `test:migration-registry` | PASS | 371/371 checks (122 migrations, v1..v122) |
| `test:upgrade-path` | PASS | Upgrade-path regression passed |
| `test:menu-printing` | PASS | fail 0 |
| `test:sold-out-backend` | PASS | 27/27 passed |
| `test:syria-tax-profile` | PASS | 46/46 passed |
| `test:tax-pack-switch-atomicity` | PASS | 62/62 passed |
| `test:cancel-closes-bill` | PASS | 30/30 passed |
| `test:issue-788-order-attempt-storage` | PASS | Order-attempt storage tests passed |
| `test:no-external-services` | PASS | 33/33 passed |
| `test:cors` | PASS | CORS IP validation and rate limiter tests passed |
| `test:csp-lan` | PASS | Dynamic CSP header tests passed |
| `npm run build` | PASS | Backend TypeScript build green |
| `npm run build:frontend` | PASS | Frontend static export green |

Total: 35 PASS, 1 FAIL (cash-closures section 15 only).

### Tests not executed, and why

- **The full `npm test` chain (220 segments).** Not run end to end in this
  audit; the targeted battery above covers the money, backup, migration,
  startup, KDS, printing-oracle, auth, and tax areas. Whether the full
  chain is green on this HEAD is unknown.
- **All Playwright browser/electron suites** (`test:e2e:browser`,
  `test:e2e:browser:tier1`, `test:e2e:browser:tier2`, `test:e2e:electron`,
  `test:e2e:server`). BLOCKED: the harness cannot start (F-001).
- **Physical-printer tests.** NOT RUN: no printer hardware in this
  environment. The `test:raster` Electron raster path was not run either
  (needs a display-capable Electron run; the plain raster suite is part of
  the full chain, not this battery).
- **Windows-only suites on Windows.** `test:windows-uninstaller` and the
  installer build run on Windows CI only; this Linux VM cannot execute
  them. The Windows installer build itself (build-windows workflow) was not
  triggered in this audit; the last recorded successful build is workflow
  run 41213831486 from the 033 head.
- **Load and capacity measurement.** No load run exists for the 500 ms p95
  target on a real LAN; the full-house burst timings are in-process
  measurements, not LAN measurements.
- **Multi-device drills.** No four-tablet Wi-Fi drill was run; the test
  matrix lists them as manual pilot-checklist items.

### Checks run on the deliverables

- `npm run docs:check` (run 2026-11-01 after both reports were written):
  markdownlint 0 issues in 0 files; relative links 322 checked OK; index
  completeness FAILED (2) — the two new pages are not yet linked from
  `docs/README.md`. The assignment limits this delivery to three files, so
  the index link is left for Ted to apply on landing (two lines, given in
  the status message). Policy check: no findings in these two files (one
  pre-existing warning in `docs/IMPLEMENTATION_REPORT_AR.md:115`,
  unrelated). `git diff --check`: clean. No other check was run on the
  deliverables, because no application file was touched.
