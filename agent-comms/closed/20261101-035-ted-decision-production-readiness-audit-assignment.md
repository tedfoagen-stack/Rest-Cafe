From: ted
To: assistant
Kind: decision
Thread: 20261101-035
Subject: ASSIGNMENT — Production-readiness audit & test plan ONLY (no fixes, no app files, nothing lands upstream)

# Authorization

Owner Ali assigned this audit on 2026-11-01 and relayed the prompt below
through Ted verbatim. Under the standing owner grant (thread 20261030-006),
this decision file carries his word. It still needs his one-line
confirmation in your own chat before you start, as usual.

Baseline at assignment time: upstream `main` head `61ab74d`. Audit the
code as it actually is at the HEAD you check out, and state that HEAD in
your report (Phase A of the prompt).

# Delivery rules (these adapt the prompt's Section 8 to our channel — read carefully)

The prompt says "do not push commits to the remote repository". The
owner's intent, confirmed by Ted: **nothing you produce lands on upstream
`main`, and no application file changes.** Our only return channel is
your fork, so delivery works exactly like previous threads, with these
limits:

1. Work on branch `assistant/production-readiness-audit` in your fork.
2. The ONLY files your delivery may contain:
   - `docs/production-readiness/RESTAURANT_PRODUCTION_AUDIT.md`
   - `docs/production-readiness/RESTAURANT_TEST_MATRIX.md`
   - one `status` message in this thread (`agent-comms/open/`) whose body
     is your FULL final executive summary (Section 9 of the prompt),
     verbatim and complete — Ted relays it to the owner in full.
3. Open ONE PR as a proposal only. Never merge it. Never push to
   upstream. No installer, no release, no tags.
4. Ted reviews the PR and reports to the owner. The two documents are
   NOT landed on upstream unless the owner separately says so.
5. Running existing tests is expected (the prompt requires recording
   exact commands and outputs). Test runs must not leave the working
   tree dirty: no modified test files, no new files outside the three
   deliverables above, no golden/fixture regeneration.
6. If your working tree is not clean when you start, stop and report
   that in a status message instead of touching anything.
7. Work in one continuous session until the delivery endpoint (the one
   PR). The 10-minute queue check is for discovering assignments only,
   never a working cadence.

# Locked owner decisions — classify as policy, not defects

The prompt (Section E and deliverable 7) asks you to separate
financial-policy decisions from technical defects. These behaviours are
recorded owner decisions; if you find them in the code, list them under
"financial-policy decisions" in your report, not as defects:

- Item refund defaults to the line total INCLUDING its consumption-fee
  share (owner-ruled correct, 2026-10-31: the customer paid the fee
  share, so it comes back). Do not flag as a defect.
- Cancelling an order that already has collected amounts stays allowed
  with manager PIN; the partially-paid bill deliberately stays live
  (owner reviewed this edge 2026-10-31 and left it as-is).
- A no-amount duplicate payment on a bill settled by a mix of discount
  and payment returns 200 no-op (owner reviewed 2026-10-31, left
  as-is). A duplicate on a bill paid fully in money IS refused (400).
- Local-only product: no cloud sync, no telemetry, no updater, no
  internet requirement for normal operations (owner decision).
- UI languages ar/en only; currencies SYP/USD only in pickers (owner
  decision; other catalogues/currencies are frozen/dormant by design).
- The single-Windows-host architecture in the prompt is itself a fixed
  owner decision.

Everything else you find stands or falls on its own evidence, per the
prompt's reporting rules. Ted has not pre-judged any other area: if you
find a real blocker, report it as one, with evidence.

---

# OWNER PROMPT (verbatim — Ali, 2026-11-01)

Rest&Cafe — Production Readiness Test Plan & Independent Audit

Mission

Perform an independent, evidence-based production-readiness assessment of the current Rest&Cafe repository.

The goal is to determine whether the application can reliably operate a real restaurant using the deployment architecture defined below.

This is an audit and test-planning task only. Do not implement fixes in this phase.

1. Mandatory deployment architecture

The following architecture is an explicit product decision and must be treated as fixed:

- One Windows PC acts as both the cashier workstation and the local host server.
- The host PC runs the Electron application, backend services, and the central SQLite database.
- All waiter tablets and kitchen display devices connect to the host over the restaurant's local Wi-Fi/LAN.
- All database access from tablets must go through the backend API.
- Tablets must never access the SQLite database file directly.
- Normal restaurant operations must not require an external internet connection.
- Backend services must start reliably when the host application or Windows starts, according to the intended deployment design.
- The host should use a stable LAN address, preferably through DHCP reservation or a documented static-IP configuration.
- Backups must be capable of being stored outside the host PC.

Do not propose a separate server or a cloud-dependent architecture unless you identify a specific, reproducible technical limitation that makes the approved architecture unsuitable.

2. Target restaurant workload

Evaluate the application against this realistic operating scenario:

- Approximately 50 restaurant tables.
- 4 waiter tablets operating simultaneously.
- 1 kitchen display system (KDS) tablet.
- 1 kitchen ticket printer.
- 1 Windows cashier PC acting as the local host.
- 1 existing USB invoice/receipt printer connected to the cashier PC.
- Central SQLite database hosted on the cashier PC.
- Local Wi-Fi/LAN connecting all devices.
- Multiple users creating, updating, paying, transferring, and closing orders concurrently.

Do not assume that the system supports this workload simply because it works with one user.

3. Phase A — Establish the actual repository baseline

Before evaluating anything:

1. Inspect the current repository and identify the actual HEAD commit and branch.
2. Inspect the current package scripts, Electron startup flow, backend startup flow, database initialization, migrations, API routes, WebSocket implementation, authentication, permissions, printing, backup, and restore mechanisms.
3. Inspect existing tests and CI workflows.
4. Identify which tests are actually executed by CI and which are only available locally.
5. Identify existing documented limitations and previously reported defects.

Do not rely on old audit reports or previous agent summaries as proof of current implementation.

Verify important claims directly against the current source code and tests.

4. Phase B — Production test scenarios

Create a detailed test matrix covering these areas.

A. Host startup and service availability

- Fresh Windows startup.
- Application launch after Windows restart.
- Backend initialization and database availability.
- Multiple tablets reconnecting after the host becomes available.
- Correct behavior when the database cannot be opened.
- Correct behavior when a required port is already occupied.
- No accidental creation of a new empty database when an existing production database is inaccessible.
- Clear error reporting when startup fails.

B. Concurrent restaurant operations

Simulate or design tests for:

- 4 waiters creating orders simultaneously.
- Different waiters updating different tables.
- Two waiters attempting to modify the same order.
- Simultaneous item additions and quantity changes.
- Moving orders between tables.
- Splitting and merging bills.
- Partial payments.
- Full payments and order closure.
- Multiple requests arriving at nearly the same time.
- Duplicate requests caused by slow Wi-Fi or client retries.

Check for lost updates, duplicate transactions, stale order states, database locks, inconsistent totals, and race conditions.

C. Kitchen workflow

Test:

- Order creation and KDS delivery.
- New items added to an existing order.
- Item cancellation and modification.
- Correct distinction between new and already-sent kitchen items.
- KDS reconnection after network interruption.
- Duplicate or missing kitchen tickets.
- Correct synchronization between waiter screens and KDS.
- Behavior when the kitchen printer is unavailable.

D. Network failure and recovery

Test:

- One tablet temporarily losing Wi-Fi.
- All tablets disconnecting simultaneously.
- Router restart.
- Host LAN address changing.
- Host backend becoming temporarily unavailable.
- Tablet reconnecting after several minutes.
- Requests interrupted while being submitted.
- Preventing duplicate orders or payments after retries.
- Correct synchronization after reconnection.

Clearly distinguish between internet failure and local network failure. External internet loss should not interrupt local restaurant operations.

E. Database integrity and financial safety

Audit and test:

- Concurrent SQLite writes.
- WAL behavior and busy timeout.
- Transaction boundaries.
- Migration safety.
- Database integrity checks.
- Backup creation and verification.
- Restore into a clean environment.
- Restore onto a replacement Windows host.
- Recovery after forced application termination.
- Recovery after unexpected Windows shutdown.

Pay special attention to:

- Refund allocation.
- Cancellation after money has been collected.
- Partial payments.
- Discounts and taxes.
- Service charges and other fees.
- Duplicate payment requests.
- Invoice consistency.
- Cash drawer and shift closure calculations.
- Audit log integrity.

Identify any unresolved financial-policy decisions separately from technical defects.

F. Printing and hardware

Inspect and test the actual printing implementation where possible:

- USB receipt printer.
- Network ESC/POS printer.
- Kitchen ticket printer.
- Arabic text rendering.
- RTL alignment.
- Latin digits.
- Long item names.
- Modifiers and add-ons.
- Multiple copies and duplicate prevention.
- Printer unavailable during order submission.
- Printer disconnect/reconnect.
- Application restart while a print job is pending.

Separate automated print tests from tests requiring real physical hardware.

Do not claim that physical printing works unless it has been tested on actual devices.

G. Security on the local network

Inspect:

- Authentication of tablet clients.
- Session expiration and invalidation.
- Role and permission enforcement on backend endpoints.
- Unauthorized access to sensitive API routes.
- WebSocket authentication and authorization.
- Rate limiting.
- Session/token storage.
- CORS and network exposure.
- Whether sensitive data is exposed unnecessarily on the LAN.

Identify practical risks without exaggerating theoretical vulnerabilities.

H. Windows deployment and recovery

Evaluate:

- Windows installer behavior.
- First installation.
- Upgrade installation.
- Application restart.
- Windows restart.
- Database location and permissions.
- Firewall requirements.
- Required ports.
- Startup behavior.
- Backup location.
- Recovery and reinstall procedure.
- What happens if the cashier PC fails completely.

Determine whether a restaurant operator can recover the system without developer intervention.

5. Phase C — Capacity and performance targets

Use these as proposed acceptance targets, not as claims about current performance.

Evaluate whether the system can meet:

- 4 simultaneous waiter clients plus 1 KDS client.
- 50 configured tables.
- 100+ active order items across the restaurant.
- Normal API response time under 500 ms at the 95th percentile on the local network, excluding printing and unusually expensive operations.
- No lost financial transactions.
- No duplicated payments caused by retries.
- No silent loss of kitchen tickets.
- Successful client reconnection after temporary network interruption.

Explain how each target can be measured and identify targets that need adjustment based on actual hardware.

6. Required deliverables

Create a report in the repository documentation, preferably:

"docs/production-readiness/RESTAURANT_PRODUCTION_AUDIT.md"

Also create:

"docs/production-readiness/RESTAURANT_TEST_MATRIX.md"

The audit report must include:

1. Actual HEAD commit and branch.
2. Repository architecture as implemented.
3. Verified capabilities.
4. Capabilities that exist but have not been adequately tested.
5. Confirmed defects, each with evidence.
6. Potential risks that require further investigation.
7. Financial-policy decisions requiring product-owner approval.
8. Missing operational procedures.
9. Prioritized P0/P1/P2 findings.
10. Recommended implementation sequence.
11. A clear go/no-go recommendation for a real restaurant pilot.

The test matrix must include:

- Test ID.
- Area.
- Scenario.
- Preconditions.
- Execution steps.
- Expected result.
- Actual result, if executed.
- Evidence or test file reference.
- Status: PASS / FAIL / NOT RUN / BLOCKED.
- Priority.

Never mark a test PASS simply because the relevant code exists.

7. Evidence and reporting rules

These rules are mandatory:

- Every confirmed defect must include a reproducible explanation and source/test references.
- Distinguish confirmed defects from unverified risks.
- Distinguish automated tests from manual hardware tests.
- Record exact commands and actual outputs for tests executed.
- Never invent test results, coverage, performance numbers, or hardware verification.
- Do not count test files as test cases.
- Do not treat successful CI as proof that the entire application is production-ready.
- Do not silently skip failing tests.
- If a test cannot be run in the current environment, mark it NOT RUN or BLOCKED and explain why.

8. Strict scope restrictions

During this task:

- Do not modify application source code.
- Do not modify database schemas or migrations.
- Do not refactor existing modules.
- Do not change dependencies.
- Do not change product behavior.
- Do not remove or add features.
- Do not change the approved host architecture.
- Do not create a release or publish an installer.
- Do not push commits to the remote repository.

Documentation files may be created only for the two requested audit deliverables.

If the working tree is not clean, do not overwrite or interfere with existing user changes. Report the condition and stop before making conflicting changes.

9. Final response

When finished, provide a concise executive summary containing:

- Overall production-readiness assessment.
- The most serious confirmed blockers.
- The most important unverified risks.
- Whether the single-Windows-host architecture appears viable.
- The first three recommended engineering tasks.
- Exact paths to the generated reports.
- Tests actually executed and their results.
- Tests not executed and why.

The objective is not to make the project look production-ready. The objective is to discover, with evidence, whether it really is production-ready for a 50-table restaurant.
