# Commonwealth.ai — Genesis Weekend Security Gate

**Purpose:** Prevent the Friday public pilot from turning the ScubaRC website into an arbitrary execution, upload, score-forging, spam, privacy, or denial-of-service surface.

**Status:** REQUIRED BEFORE PUBLIC RELEASE. This gate is narrower and more conservative than the long-term Community Compute design. If any launch-blocking control below is not proven, the affected feature stays disabled.

## Security model

```text
Volunteer device != trusted device
Returned result != authoritative result
Client score != leaderboard score
Registration != verified compute
Public input != trusted input
```

The browser is untrusted. All consequential validation and all statistics used for the Genesis report are computed server-side from accepted records.

## 1. Public attack surface

Public endpoints for Genesis Weekend must be limited to the minimum needed:

- `POST /api/compute/enroll`
- `POST /api/compute/work`
- `POST /api/compute/result`
- `GET /api/compute/stats`
- `POST /api/compute/game/start`
- `POST /api/compute/game/result`
- `GET /api/compute/leaderboard`

There is **no** generic upload endpoint, arbitrary file submission, arbitrary URL fetch, shell command, PowerShell, package installation, dynamic code download, researcher-supplied executable, remote desktop, filesystem access, camera, microphone, location sensor, or private-network access.

## 2. Fail closed

Public production must fail closed when a protection is missing.

- `COMMUNITY_DB` missing -> feature unavailable.
- `TURNSTILE_SECRET` missing in public production -> enrollment unavailable. Do not silently bypass human verification.
- Invalid/missing node token -> work/result/game endpoints reject.
- Unknown work type -> reject.
- Unknown game/run type -> reject.
- Expired assignment/run -> reject.
- Any schema violation -> reject.
- Any payload above its hard byte/event limit -> reject.

Development bypasses, if any, must require an explicit non-production environment flag and must never be the default.

## 3. Cloudflare perimeter controls

Before public launch configure:

- Turnstile on enrollment.
- Cloudflare rate limiting/WAF rules for enrollment, work, result, game-start, and game-result.
- More restrictive limits on enrollment and game-start than public read-only stats/leaderboard.
- Bot/abuse challenge when request patterns exceed normal human play/contribution behavior.
- A global emergency kill switch for Compute and Game independently so ScubaRC can pause either feature without taking down the main website.

Initial limits should favor safety over maximum throughput. They can be loosened after Friday telemetry is understood.

## 4. One outstanding unit/run per node

A node must not be able to create unbounded database work by repeatedly asking for tasks.

Before issuing new machine work:

- if the node already has a non-expired `issued` assignment, return/reuse that assignment or refuse a second one;
- cap assignment lifetime;
- expire abandoned assignments;
- cap task size/iterations server-side.

Before starting a new scored game run:

- allow at most one active non-expired run per node/player token;
- issue a server-generated run ID and seed/scenario;
- expire abandoned runs;
- reject replayed/completed run IDs.

## 5. Server authority

### Machine compute

Server generates the work ID, type, seed/input, allowed limits, expiration, and expected deterministic result. The client returns only the constrained result receipt. The server independently verifies it.

### Game

The browser never submits an authoritative score. It submits a bounded move/event log tied to a server-issued run ID and scenario. The server recomputes the score and leaderboard placement.

For the $25 contest:

- server score only;
- duplicate/replayed run rejection;
- impossible timing/event sequences rejected;
- winner must be associated with the valid run/device token used during the event;
- ScubaRC may disqualify automated/tampered runs under the posted rules.

## 6. Input and output safety

All public input is hostile until validated.

- Require JSON on API write endpoints.
- Hard request-body limits.
- Fixed schemas and enums.
- Maximum lengths for every string.
- Parameterized D1 SQL only.
- No SQL/string concatenation from public input.
- Nicknames/localities are plain text, never HTML.
- Render public nicknames with `textContent` or equivalent escaping; never `innerHTML` with raw user input.
- No user-controlled redirects or external fetch destinations.
- Public stats expose aggregates only, not email addresses, bearer tokens, user agents, or raw event logs.

## 7. Browser/site hardening

The existing `_headers` file already provides HSTS, frame denial, nosniff, no-referrer, a restrictive permissions policy, and no-store caching. Before public launch add/test a Content Security Policy that allows only the resources required by the ScubaRC site and Cloudflare Turnstile.

Target policy shape (adjust only as required by tested Turnstile behavior):

```text
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
connect-src 'self' https://challenges.cloudflare.com;
img-src 'self' data:;
style-src 'self';
worker-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'self';
```

Also evaluate/test:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

Do not add `unsafe-eval`. Avoid `unsafe-inline`; if Turnstile integration requires a specific exception, document it rather than broadly weakening CSP.

## 8. Minimize stored personal information

Genesis Weekend does not need a conventional account system.

Recommended Friday posture:

- nickname/display name: optional for compute, required only for contest leaderboard;
- Virginia opt-in: optional;
- locality: optional and coarse (city/county), not precise location;
- email: remove from the Friday Alpha unless there is a concrete operational need;
- do not collect address, phone, date of birth, precise GPS, contacts, files, device serial numbers, or advertising identifiers.

A browser/device identifier is not proof of a unique human. Monday reporting should distinguish **participant enrollments**, **registered nodes**, and **nodes that completed verified work**. Do not call raw enrollments unique people unless independently established.

## 9. Token/secrets discipline

- Node bearer token generated with cryptographic randomness.
- Store only its hash server-side.
- Never log or expose Turnstile secret, D1 credentials, node bearer tokens, or admin credentials.
- Public JavaScript contains no secrets.
- Revoked node tokens fail closed.
- Administrative controls are not exposed through the public compute API.
- Any future private/admin dashboard should be behind Cloudflare Access or another explicit authenticated control plane.

## 10. Supply-chain posture for Friday

For Genesis Weekend, prefer original small JavaScript/CSS game code over adding a third-party game framework at the last minute.

- No unnecessary npm dependencies.
- No third-party CDN game scripts.
- If an external dependency becomes unavoidable, pin the exact version, review its license/source, and record why it was needed.

This reduces both licensing and supply-chain risk under the Friday deadline.

## 11. Abuse/DoS containment

- Per-IP/per-token endpoint rate limits.
- Per-node active assignment/run caps.
- Hard body/event limits.
- Hard maximum work iterations/runtime.
- Fixed maximum leaderboard nickname length.
- Bounded public leaderboard size (for example top 20/50, not unbounded rows).
- Expiration/cleanup for abandoned assignments and game runs.
- Reject repeated invalid receipts rather than endlessly processing them.
- Security/rejection events counted for monitoring without storing hostile payload bodies.
- Emergency pause switches for compute and game.

## 12. Required adversarial launch tests

The public launch is BLOCKED until the relevant enabled feature passes these tests.

### Compute

1. Correct work returns verified receipt.
2. Deliberately incorrect result is rejected.
3. Unknown work ID rejected.
4. Expired assignment rejected.
5. Missing/invalid/revoked token rejected.
6. Duplicate receipt rejected.
7. Oversized JSON rejected.
8. Unsupported work type rejected.
9. Repeated `/work` calls cannot generate unbounded outstanding assignments.
10. No upload/executable/shell path exists.

### Game

1. Valid run produces server-computed score.
2. Client-edited local score does not affect leaderboard.
3. Duplicate run submission rejected.
4. Expired run rejected.
5. Malformed/oversized event log rejected.
6. Impossible event timing/sequence rejected.
7. HTML/script nickname is displayed as harmless text.
8. Automated request flood triggers rate-limit/abuse controls.
9. One node/player cannot create unbounded active runs.
10. Leaderboard reads expose only intended public fields.

### Site

1. CSP is active and page/Turnstile/game still function on Windows Edge/Chrome, Android Chrome, and iPhone Safari.
2. Main ScubaRC pages remain functional if Community Compute is paused.
3. Compute/Game kill switches work.
4. No secret appears in browser source/network responses.
5. A device that has never visited ScubaRC can scan the production QR and complete the intended flow.

## 13. Launch verdict

Only three launch states are allowed:

- `COMPUTE=GO, GAME=GO`
- `COMPUTE=GO, GAME=HOLD`
- `COMPUTE=HOLD, GAME=HOLD`

There is no `GO WITH KNOWN SECURITY BLOCKER` state.

Game polish, leaderboard animation, analytics cosmetics, and additional research mechanics may slip. The trust boundary may not.
