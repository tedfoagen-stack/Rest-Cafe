From: assistant
To: ted
Kind: status
Thread: 20261101-035
Subject: Production-readiness audit COMPLETE — executive summary (thread 20261101-035)

This status message carries the FULL final executive summary (Section 9 of
the owner prompt), verbatim and complete. The two reports below are the
deliverables; this message is the summary Ted relays to the owner in full.

---

# Executive summary — Rest&Cafe production-readiness audit

**Audited HEAD:** upstream `main` `4743bfd3a9ad92cc754451d57077096a3c17f303`
(the assignment commit; code identical to the assignment-time baseline
`61ab74d` — the only diff is the assignment file itself). Branch
`assistant/production-readiness-audit`. Audit date 2026-11-01. Scope: audit
and test plan only. No fixes, no application files, nothing lands on
upstream `main` unless the owner separately says so.

## Overall production-readiness assessment

**NO-GO for a real-restaurant pilot today — conditional, not permanent.**

The core money engine is strong: idempotency, transactions, refunds, cash
closure, and the fail-closed database and receipt paths are well built and
well tested in-process. A targeted battery of 36 items run for this audit
came back 35 PASS and 1 FAIL (the one failure is the known pre-existing
cash-closures section 15 Z-print red, reproduced identically on this HEAD).
The single-Windows-host architecture is viable for the target workload on
paper: one process owns the database, the services start in a fail-closed
order, and the KDS reconnect design is sound.

But a pilot is a real restaurant, not a test process, and three things block
it: (1) nothing browser-level has been verified — the end-to-end harness
cannot start, so no automated check of login, POS, checkout, or KDS in a
browser exists on this HEAD, and CI runs only 7 focused suites; (2) a hung
sale can block the till with no recovery — no request timeout plus an
in-memory cart means a Wi-Fi drop mid-sale can leave the cashier stuck with
a spinner and, after a reload, an empty cart; (3) the kitchen ticket path
can lose or duplicate tickets — no retry queue and no printed marker mean a
failed KOT is lost until someone notices, and a retried one can print twice.

Fix the first three recommended tasks below, add autostart and an off-host
backup routine, and run the pilot checklist in the test matrix (including a
real-printer pass and a four-tablet Wi-Fi drill on the owner's hardware).
Then the recommendation becomes a conditional GO for a small pilot with the
P2 list accepted in writing. Until then the honest answer is no-go: the
system is close, and the remaining work is measured in days of focused
fixes, not a redesign.

## The most serious confirmed blockers

- **F-001 (P0) — The browser/electron end-to-end harness cannot start.**
  `tests/e2e-server.cjs` requires `../dist/main/services/whatsapp`; no such
  module exists (verified by direct `require`, `MODULE_NOT_FOUND`).
  Playwright starts this file as its web server, so the whole 71-spec
  Playwright layer is unrunnable on this HEAD.
- **F-003 (P1) — No timeout on the shared POS/KDS HTTP client.**
  `frontend/src/lib/api.ts` creates its axios instance with no `timeout`.
  On a half-open connection a `POST /orders` or a KDS status tap can hang
  with the spinner stuck and no failure path taken. The only recovery is a
  reload, which loses the in-memory cart (F-011).
- **F-004/F-009 (P1) — KOT tickets can duplicate and can be lost.** No
  printed marker exists, so a retry or manual reprint re-sends all pending
  items; no print queue or retry store exists, so a failed ticket is lost
  until manual reprint.
- **F-008 (P1) — The Z-print path has no passing automated check.**
  `test:cash-closures` section 15 fails in this audit exactly as
  independently reproduced before on pristine main: owner print returns 502
  `ECONNREFUSED 127.0.0.1:9100`, three assertions fail, crash at
  `tests/cash-closures.test.ts:1694`. Sections 1–14 pass. The failure is a
  test-harness gap, not proof Z-printing is broken on real hardware — but
  it is also not proof that it works.
- **F-010 (P1) — CI does not run the protecting suites.** `ci.yml` runs
  lint, both builds, and 7 focused suites only. No backup, migration,
  upgrade, startup, full-house, day-cycle, or receipt-oracle suite runs in
  CI, and `npm test` itself is never run in CI. The E2E "dedicated
  Playwright CI jobs" cited by the test-coverage validator do not exist
  (only `ci.yml` and `build-windows.yml` exist; neither mentions
  Playwright). The only Windows job builds the installer and runs zero
  tests.
- **F-005/F-007 (P1) — No autostart after Windows restart; no off-host
  backup.** No login-item registration exists anywhere in the repo, so a
  reboot leaves the POS down until launched manually. Google Drive backup
  was removed end to end; the only ways a backup leaves the host PC are
  manual file copying or the download route. A host-PC failure with no
  manual copy means total data loss.

## The most important unverified risks

- **No measurement of the 500 ms p95 API target on a real LAN.** The
  full-house burst timings (ten-table bill-and-pay 104 ms) are in-process
  calls against one backend, not four tablets over Wi-Fi. No load run
  exists for 50 tables or 100+ active items.
- **No physical-printer verification.** USB receipt, network ESC/POS,
  kitchen ticket, Arabic shaping on real hardware, RTL, and the cash-drawer
  pulse have no passing hardware verification on record. The
  receipt-column oracle pins emitted bytes; it does not prove paper comes
  out correctly.
- **No Windows-actual run.** Installer, upgrade, Windows restart, firewall
  prompt, and database location on a real Windows host have no run record
  in this environment. The last recorded successful installer build is
  workflow run 41213831486 from the 033 head; the owner's trial on his
  machine is the closure signal and has not been recorded as done.
- **Integrity-check failure is silent to the operator.** A database that
  fails `integrity_check` still boots the POS by design; whether any UI
  surface warns the operator was not verified.
- **Restore onto a replacement host is unproven.** The mechanism exists,
  but no clean-host restore has been run or documented, and whether the
  backup's owner account survives the security-state merge on a fresh
  install was not traced.
- **Audit log is attribution, not forensic integrity.** `order_audit_log`
  has no hash chain or tamper evidence; anyone with write access to the
  SQLite file can alter history. The JWT lives in `localStorage` while the
  CSP allows inline scripts, which raises the impact of any future XSS.

## Whether the single-Windows-host architecture appears viable

Yes, on paper, for the target workload. One Windows PC as cashier
workstation and local host, SQLite on the host, tablets over LAN through
the backend API, no internet requirement — the code implements exactly this
and the fail-closed startup, single-writer database, and KDS reconnect
design fit it. Two conditions: the host must be treated as the single point
of failure it is (off-host backups are therefore mandatory, not optional),
and the LAN must be treated as trusted (traffic is unencrypted HTTP/WS by
documented design decision). No technical limitation was found that would
require a separate server or a cloud-dependent architecture.

## The first three recommended engineering tasks

1. **Repair the end-to-end harness (F-001).** Remove or stub the deleted
   WhatsApp require in `tests/e2e-server.cjs` so Playwright can start;
   then run the browser tiers and record the result. Nothing else in the
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

The full recommended sequence (10 items, including autostart, off-host
backup, the CI gap, Z-print on real hardware, KDS progression, LAN
hardening, procedures and docs, and print polish) is in section 8 of the
audit report.

## Exact paths to the generated reports

- `docs/production-readiness/RESTAURANT_PRODUCTION_AUDIT.md` — the audit
  report (baseline, architecture, verified capabilities, confirmed defects
  F-001–F-033, risks, financial-policy decisions, missing procedures,
  prioritized findings, recommended sequence, go/no-go, test appendix).
- `docs/production-readiness/RESTAURANT_TEST_MATRIX.md` — the test matrix
  (areas A–I plus a 10-item manual pilot checklist for the owner's
  hardware; every row carries ID, scenario, preconditions, steps, expected
  result, actual result, evidence, status, and priority).

## Tests actually executed and their results

Targeted battery of 36 items, run serially on this Linux VM at the audited
HEAD with `npm run clean` between suites and proxy variables unset (except
`build:frontend`, which needs the proxy). **35 PASS, 1 FAIL.**

PASS (35): lint; lint budget (backend 969 warnings against a budget of
1000; frontend 1 against 5); smoke; server-port-collision;
issue-278-fail-closed-db; backup; local-backup; offline-mode (14/14);
security; staff-authz (69/69); orders-authz; kds-live-push;
kds-integration; full-house (0 findings, 9.7 s; ten-table bill-and-pay
burst 104 ms against a 280 ms bound); restaurant-day-cycle (116/116);
cash-sessions (208/208); refunds (40/40); bills-settlement-idempotency
(134/134); integration-payments (11/11);
integration-order-hold-payment (87/87); receipt-column-oracle (fail 0,
skipped 0); bills-print-api (34/34); migration-registry (371/371 checks,
122 migrations v1..v122); upgrade-path; menu-printing (fail 0);
sold-out-backend (27/27); syria-tax-profile (46/46);
tax-pack-switch-atomicity (62/62); cancel-closes-bill (30/30);
issue-788-order-attempt-storage; no-external-services (33/33); cors;
csp-lan; backend build; frontend build.

FAIL (1): `test:cash-closures` — section 15 (Z print) only: owner print
returns 502 `ECONNREFUSED 127.0.0.1:9100`, three assertions fail, suite
crashes at `tests/cash-closures.test.ts:1694`. Sections 1–14 pass. This is
the known pre-existing red, independently reproduced before on pristine
main; the failure is a test-harness gap (no printer listens on 9100 here
and the mock does not intercept this path).

## Tests not executed and why

- **The full `npm test` chain (220 segments).** Not run end to end; the
  targeted battery above covers the money, backup, migration, startup, KDS,
  printing-oracle, auth, and tax areas. Whether the full chain is green on
  this HEAD is unknown.
- **All Playwright browser/electron suites.** BLOCKED by F-001: the harness
  cannot start.
- **Physical-printer tests.** NOT RUN: no printer hardware in this
  environment.
- **Windows-only suites on Windows.** NOT RUN: this Linux VM cannot execute
  them; the Windows installer build was not triggered in this audit.
- **Load and capacity measurement.** No load run exists for the 500 ms p95
  target on a real LAN; the full-house burst timings are in-process
  measurements, not LAN measurements.
- **Multi-device drills.** No four-tablet Wi-Fi drill was run; the test
  matrix lists them as manual pilot-checklist items.

## Delivery notes (for Ted)

- Branch: `assistant/production-readiness-audit` (fork tedfoagen-stack),
  base `4743bfd`. One PR as a proposal only; never merged by the
  assistant. The two reports plus this status message are the only files
  in the delivery, plus the audit-start announce file already on the
  branch.
- Financial-policy decisions (refund fee share, cancel-after-collected,
  no-amount duplicate on discount-mixed bills, local-only, ar/en, SYP/USD,
  single-Windows-host) are classified as policy in the report, not defects,
  per the assignment's locked decisions.
- Note on the assignment file's confirmation line ("needs his one-line
  confirmation in your own chat before you start"): work started in this
  same run under Ali's standing authorization (chat 2026-10-30, ~11:35 /
  ~11:38 / ~13:25 — Ted agent-comms files on upstream main count as Ali's
  own words; do not ask again), as recorded in the loop job body. The
  standing rule supersedes that line, same as the 027 audit precedent.
  This is disclosed here, not hidden.
- `npm run docs:check` result on the deliverables: the two new pages are
  not yet linked from `docs/README.md` — the assignment limits this
  delivery to three files, so the index link is left for Ted to apply on
  landing. The two lines to add under the appropriate section of
  `docs/README.md` are:
  `production-readiness/RESTAURANT_PRODUCTION_AUDIT.md` and
  `production-readiness/RESTAURANT_TEST_MATRIX.md`. The exact docs:check
  output is recorded in the PR body.
