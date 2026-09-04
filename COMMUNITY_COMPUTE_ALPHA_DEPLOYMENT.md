# ScubaRC Community Compute Alpha — Deployment

This branch adds a browser-first Community Compute Alpha to the existing Cloudflare Pages site.

## What is implemented

- `compute.html` — public contributor portal
- `compute.css` — portal styles
- `compute.js` — capability registration, work request, browser-worker execution, receipt submission, live stats
- `compute-worker.js` — fixed bounded `mix32_v1` workload; no arbitrary code download
- `functions/api/compute/enroll.js` — contributor/node enrollment
- `functions/api/compute/work.js` — simple capability-aware task governor with three-way replication target
- `functions/api/compute/result.js` — constrained result receipt validation/admission
- `functions/api/compute/stats.js` — public aggregate statistics
- `schema/community_compute.sql` — D1 schema

## Required Cloudflare configuration before public launch

1. Create a D1 database for the Alpha, e.g. `scubarc-community-compute-alpha`.
2. Apply `schema/community_compute.sql` to that database.
3. Bind the D1 database to the Pages project as `COMMUNITY_DB` for preview and production.
4. Create a Cloudflare Turnstile widget for the public compute page.
5. Add the Turnstile secret as the Pages secret `TURNSTILE_SECRET`.
6. Put the public Turnstile site key in `compute-config.js` and render the widget before broad public recruitment.
7. Add Cloudflare rate limiting/WAF rules for `/api/compute/enroll`, `/api/compute/work`, and `/api/compute/result` before LinkedIn-scale traffic.
8. Deploy the feature branch to a Pages preview first; test from desktop, laptop, Android, and iPhone browsers.

## Alpha safety boundary

- No native installer.
- No arbitrary executable download.
- No shell/PowerShell execution.
- No arbitrary file upload endpoint.
- No private/CUI/classified/medical research data.
- Node tokens are random bearer credentials stored only in the contributor browser.
- Server stores only a hash of each node token.
- Results are schema-constrained and verified against server-side expected output.
- Volunteer nodes have no authority over canonical research state.

## Evidence to capture for the Virginia demonstration

Track and report separately:

- people enrolled
- Virginia opt-in contributors
- registered devices
- devices that actually completed at least one work unit
- logical CPU threads represented
- WebGPU-capable devices
- verified work units
- rejected/corrupt work units
- aggregate verified compute time
- localities represented

Do not present registrations as compute delivered. The strongest proof is verified execution.

## Next technical gate

Before merging to `site-v2` for public preview:

1. configure D1 + Turnstile;
2. run a 5–10 device closed test;
3. deliberately submit one incorrect result and prove rejection;
4. verify no arbitrary upload or executable path exists;
5. review privacy/consent copy;
6. only then open the 100–150 node Founding Compute Cohort.
