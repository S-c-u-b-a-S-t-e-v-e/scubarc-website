# Commonwealth.ai — Genesis Weekend Implementation Plan

**Target:** public-ready ScubaRC Community Compute pilot by Friday night, with a closed multi-device test completed earlier the same day and Genesis Weekend evidence collected through Sunday for a Monday consortium briefing.

## Mission

Prove that ordinary Virginians can contribute both machine compute and human problem-solving to a governed research network through a simple browser experience.

The public-facing concept for this pilot is **Commonwealth.ai** with the line **Built by the Commonwealth.** This is a working pilot identity only and should not be treated as a finalized trademark/domain claim until naming checks are complete.

## Success thresholds

- **Minimum:** 50 real participants and at least 50 devices completing one verified work unit.
- **Target:** 100 participating/verified devices.
- **Stretch:** 150 participating/verified devices over Friday–Sunday.
- Registrations and page visits must never be reported as delivered compute.

## Public experience

One QR code opens the ScubaRC Community Compute page. The user chooses one or both modes:

### 1. Donate Compute

- Browser capability check.
- Explicit consent.
- Receive one bounded work envelope.
- Execute the fixed browser workload in a Web Worker.
- Return a schema-constrained receipt only.
- Server independently verifies the result.
- No arbitrary file uploads, shell access, native installer, secrets, or sensitive data.

### 2. Play for Research — Commonwealth Dispatch

A simple original hybrid browser game inspired by endless-runner and falling-block mechanics, without copying third-party branding, assets, or proprietary code.

**Dispatch/Surf mode:**
- Three simple lanes/resources.
- Research jobs appear with requirements and changing node choices.
- Player left/right/tap decisions create candidate `Task -> Resource` scheduling decisions.
- Speed and difficulty increase gradually.

**Crash/Recovery mode:**
- A node failure/bottleneck triggers a short falling-block recovery puzzle.
- Blocks represent stranded workloads; columns/capacity represent remaining resources.
- Player repacks/reassigns work.
- Complete a small recovery objective, then return to Dispatch mode.

Every meaningful game move is captured as a candidate scheduling/recovery decision. The server, not the browser, computes the authoritative score.

## Prize/leaderboard

- Friday/bar event prize: **$25 for the highest server-validated score shown on the live leaderboard at the stated closing time.**
- Free entry.
- Unlimited attempts.
- Display nickname only on public leaderboard.
- No automation/tampering.
- Tie breaker: first valid score achieved.
- Bartender checks the live server leaderboard rather than trusting a screenshot/local score.

## Architecture boundary

```text
Volunteer device != trusted device
Returned result != authoritative result
Compute contributed != authority granted
```

Machine-work results and game-run events enter as untrusted candidates. Server-side validation determines whether they count toward verified statistics or the leaderboard.

## Friday execution sequence

### Gate 0 — Scope freeze

Must ship:
- QR-accessible portal.
- Donate Compute path.
- Commonwealth Dispatch path.
- server-authoritative leaderboard.
- aggregate Genesis dashboard.
- mobile + desktop browser compatibility.
- bounded payloads and no arbitrary uploads.

Do **not** add before launch:
- native iOS/Android apps,
- persistent background agents,
- arbitrary researcher code,
- full research marketplace,
- Zero Four production integration,
- complex accounts/password recovery,
- real-money/equity incentives,
- sensitive research workloads,
- elaborate 3D graphics.

### Gate 1 — Backend/infrastructure

1. Create Cloudflare D1 database for Community Compute Alpha.
2. Apply `schema/community_compute.sql` plus game/leaderboard schema additions.
3. Bind database as `COMMUNITY_DB` to preview and production Pages environments.
4. Configure Cloudflare Turnstile and `TURNSTILE_SECRET`.
5. Add rate limiting/WAF protection to enrollment, work, result, game-start, and game-result endpoints.
6. Deploy feature branch to Cloudflare Pages preview.

### Gate 2 — Commonwealth Dispatch implementation

Required game endpoints/data:
- `/api/compute/game/start`
- `/api/compute/game/result`
- `/api/compute/leaderboard`
- immutable/unique run ID
- server-generated game seed/scenario
- bounded move/event log
- authoritative server-side score recomputation
- duplicate-run rejection
- run expiration
- nickname sanitation/length limits

The browser must never be able to submit an unchecked final score that becomes authoritative.

### Gate 3 — Closed test

Run at least 5–10 unrelated devices before public release:
- Windows Edge/Chrome
- Android Chrome
- iPhone Safari
- at least one older computer if available

Prove end to end:

```text
QR -> portal -> consent -> enroll -> bounded compute -> receipt -> verification
QR -> game -> completed run -> server score -> leaderboard
```

### Gate 4 — Adversarial checks

Before public traffic:
- wrong compute result is rejected;
- arbitrary/oversized result payload is rejected;
- bogus work ID is rejected;
- invalid/revoked node token is rejected;
- duplicate receipt is rejected;
- locally edited game score does not alter server score;
- duplicate game run is rejected;
- malformed move/event log is rejected;
- nickname/script injection is rendered harmless;
- no arbitrary upload/executable path exists.

If the game is not safe/reliable by the release gate, **Donate Compute launches anyway** and the game remains unavailable until fixed. Do not miss Genesis Weekend over game polish.

### Gate 5 — Public/event layer

- Generate one QR code to the production ScubaRC compute page.
- Display **Commonwealth.ai — Built by the Commonwealth** and label it a ScubaRC pilot.
- Add live leaderboard.
- Add Genesis aggregate counters.
- Add concise contest rules and privacy/consent copy.
- Confirm the QR works from a device/browser that has never visited the site.

## Genesis Weekend evidence ledger

Capture these separately and preserve the raw counts needed to reconstruct every public statistic:

### Participation
- unique humans enrolled;
- Virginia opt-in participants;
- Virginia localities represented;
- devices registered;
- devices completing at least one verified work unit;
- mobile vs desktop;
- logical CPU threads represented;
- WebGPU-capable devices.

### Machine contribution
- work units issued;
- work units completed;
- verified work units;
- rejected/corrupt results;
- aggregate verified runtime;
- completion/failure rate;
- device-class distribution.

### Human contribution
- unique game players;
- completed game runs;
- dispatch decisions;
- recovery decisions/solutions;
- valid vs rejected runs;
- best score;
- median/average score;
- best human scheduling score vs baseline algorithm when measured honestly.

## Monday deliverable

Prepare a short **Commonwealth.ai Genesis Weekend Report** for the Virginia AI consortium.

The report should answer one question:

> Can ordinary residents become a measurable, governable part of Virginia's research infrastructure?

Report only measured results. Example structure:

1. What ScubaRC tested.
2. Number of people and actual executing devices.
3. Machine compute delivered.
4. Human scheduling/recovery decisions generated.
5. Security/governance boundaries demonstrated.
6. Failures and lessons learned.
7. Proposed 30-day Virginia academic pilot.

Do not claim 150 home computers replace institutional HPC. Position Community Compute as a complementary distributed tier for suitable parallelizable, public/non-sensitive research workloads.

## Proposed next ask to the Virginia consortium

If Genesis succeeds:

> Give Commonwealth.ai one public-data research problem, one Virginia academic partner, and 30 days to demonstrate governed community compute on a real workload.

## Current implementation state

The existing `feature/community-compute-alpha` branch already contains the browser contributor portal, capability registration, fixed Web Worker workload, enrollment endpoint, task assignment, constrained result receipts, aggregate stats, and D1 schema. The immediate remaining critical path is Cloudflare configuration, Commonwealth Dispatch + authoritative leaderboard, closed-device validation, adversarial testing, and production release.
