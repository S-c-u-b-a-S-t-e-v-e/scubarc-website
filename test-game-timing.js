// GAME-003F-R02 executable local admission tests; requires Node and installed Wrangler.
// Create the mission-specified temporary wrangler.toml, then:
// wrangler d1 execute COMMUNITY_DB --local --persist-to <temporary-directory> --file schema/community_compute.sql
// wrangler pages dev --port 8788 --persist-to <temporary-directory>
// Set GAME_TEST_PERSIST to that directory and run: node test-game-timing.js
// Optional GAME_TEST_EVIDENCE writes JSON results. Run test-game-client.js separately.
// Long-run fixtures backdate server-issued rows through Wrangler D1; no clock sleeps or auth bypass.
// Use a fresh local database. Remove temporary config/data after stopping the harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const base = process.env.TEST_URL || 'http://127.0.0.1:8788';
const persist = process.env.GAME_TEST_PERSIST;
const wrangler = process.env.GAME_TEST_WRANGLER || `${process.env.APPDATA}/npm/node_modules/wrangler/bin/wrangler.js`;
assert(persist, 'Set GAME_TEST_PERSIST to the local Pages --persist-to directory');
const evidence = {}, accepted = [];
function record(name, data) { evidence[name] = data; console.log(name, JSON.stringify(data)); }
// Fixture changes use supported local Wrangler commands exclusively.
function sql(query) {
  return JSON.parse(execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'COMMUNITY_DB', '--local', '--persist-to', persist, '--command', query, '--json'], { encoding: 'utf8', windowsHide: true }))[0].results;
}
async function request(path, body, token) {
  const r = await fetch(base + '/api/compute' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}
function load(file, browser = false) {
  let src = fs.readFileSync(file, 'utf8');
  src = browser ? src.slice(src.indexOf('  function mulberry32'), src.indexOf('  async function api')) : src.slice(src.indexOf('function getContestDay'), src.indexOf('export async'));
  return vm.runInNewContext(`${browser ? 'const OBSTACLE_TYPES = ["buoy","rock","debris"];' : ''}${src}; ({mulberry32,generateCourse${browser ? '' : ',validateTiming,simulateSurfRun'}})`);
}
const server = load('functions/api/compute/game/result.js');
const browser = load('commonwealth/surf/game.js', true);
const event = (timestamp_ms, event_type) => ({ timestamp_ms, event_type, payload: '{}' });
const log = end => [event(0, 'run_started'), event(end, 'run_ended')];
async function main() {
  let min = 1, max = 0;
  for (const seed of [0, 1, 42, 2147483647, 4294967295]) {
    const a = server.mulberry32(seed), b = browser.mulberry32(seed);
    for (let i = 0; i < 100000; i++) { const x = a(); assert(x >= 0 && x < 1); assert.equal(x, b()); min = Math.min(min, x); max = Math.max(max, x); }
    const sc = JSON.parse(JSON.stringify(server.generateCourse(seed)));
    const bc = JSON.parse(JSON.stringify(browser.generateCourse(seed))).map(o => ({ ...o, type: ['buoy', 'rock', 'debris'].indexOf(o.type) }));
    assert.deepEqual(sc, bc);
    let prior = 0;
    for (const o of sc) { assert([0, 1, 2].includes(o.lane)); assert(o.distance_cm - prior >= 20000 && o.distance_cm - prior <= 49900); prior = o.distance_cm; }
    assert(prior > 2000000 && prior <= 2049900);
  }
  const collisionCourse = [{ distance_cm: 500, lane: 0 }, { distance_cm: 1000, lane: 1 }, { distance_cm: 1500, lane: 2 }];
  assert.equal(server.simulateSurfRun(collisionCourse, log(500)).distanceCm, 250);
  assert.equal(server.simulateSurfRun(collisionCourse, log(1500)).distanceCm, 750);
  const collision = server.simulateSurfRun(collisionCourse, log(3000));
  assert.equal(collision.durationMs, 2000); assert.equal(collision.terminalReason, 'collision');
  const created = new Date(Date.now() - 1000).toISOString();
  assert.equal(server.validateTiming(log(1000), created, new Date(Date.parse(created) + 1000).toISOString()), true);
  assert.equal(server.validateTiming(log(1001), created, new Date(Date.parse(created) + 1000).toISOString()), false);
  record('REPLAY_COLLISION_AND_VARIABLE_TTL', { pass: true });
  record('PRNG_RANGE', { pass: true, samples: 500000, min, max }); record('COURSE_PARITY', { pass: true, seeds: 5 });
  const id = `r02_${Date.now()}`, token = id + '_local_fixture';
  const hash = createHash('sha256').update(token).digest('hex'), now = new Date().toISOString();
  sql(`INSERT INTO contributors(contributor_id,created_at,consent_version) VALUES('${id}','${now}','test'); INSERT INTO nodes(node_id,contributor_id,created_at,last_seen,logical_processors,wasm_support,webgpu_support,device_class,token_hash,status) VALUES('${id}','${id}','${now}','${now}',4,1,0,'desktop','${hash}','active');`);
  const start = () => request('/game/start', { node_id: id }, token);
  const submit = (run, events) => request('/game/result', { node_id: id, run_id: run.run_id, events, nickname: id }, token);
  const concurrent = await Promise.all(Array.from({ length: 10 }, start));
  concurrent.forEach(r => assert.equal(r.status, 200, JSON.stringify(r)));
  assert.equal(new Set(concurrent.map(r => r.data.run_id)).size, 1); assert.equal(concurrent.filter(r => !r.data.reused).length, 1);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM game_runs WHERE node_id='${id}' AND status='active'`)[0].n, 1);
  record('TRUE_CONCURRENT_START', { pass: true, requests: 10, unique_runs: 1, newly_created: 1 });
  const first = concurrent[0].data;
  await new Promise(r => setTimeout(r, 1100));
  const reused = await start(); assert.equal(reused.data.run_id, first.run_id); assert(reused.data.remaining_ms < first.remaining_ms);
  record('ACTIVE_REUSE', { pass: true, remaining_ms: reused.data.remaining_ms });
  async function check(name, events, expected = 'invalid_timing', age = null) {
    const r = await start(); assert.equal(r.status, 200); const run = r.data;
    if (age !== null) {
      const created = Date.now() - age;
      sql(`UPDATE game_runs SET created_at='${new Date(created).toISOString()}', expires_at='${new Date(created + 600000).toISOString()}' WHERE run_id='${run.run_id}'`);
    }
    const result = await submit(run, events);
    if (expected === 'accepted') {
      assert.equal(result.status, 200, JSON.stringify(result)); const d = result.data;
      assert(Number.isFinite(d.duration_ms) && d.duration_ms >= 0 && d.duration_ms <= events.at(-1).timestamp_ms && d.duration_ms <= 600000);
      assert.equal(d.distance_cm, d.duration_ms * 0.5); assert.equal(d.distance_miles, (d.distance_cm / 160934.4).toFixed(2)); accepted.push(d);
    } else { assert.equal(result.data.error, expected, JSON.stringify(result)); assert(result.status >= 400); }
    record(name, result);
    if (expected !== 'accepted') sql(`UPDATE game_runs SET status='rejected' WHERE run_id='${run.run_id}'`);
    return { run, result };
  }
  const short = await check('NORMAL_1S_RUN', log(1000), 'accepted'); assert.equal(short.result.data.distance_cm, 500);
  const duplicate = await submit(short.run, log(1000)); assert.equal(duplicate.status, 409); record('DUPLICATE_RESULT', duplicate);
  const safeLog = end => {
    const events = [event(0, 'run_started')];
    for (const o of server.generateCourse(first.seed)) {
      const time = o.distance_cm * 2; if (time > end) break;
      events.push(event(time - 100, 'steer_center')); if (o.lane === 1) events.push(event(time - 50, 'steer_left'));
    }
    events.push(event(end, 'run_ended')); return events;
  };
  const long = await check('NORMAL_LONG_RUN', safeLog(120000), 'accepted', 121000); assert.equal(long.result.data.distance_cm, 60000);
  await check('EPOCH_ATTACK', [event(Date.now(), 'run_started'), event(Date.now() + 1000, 'run_ended')]);
  await check('HUGE_TIMESTAMP', [event(999999999, 'run_started'), event(1000000000, 'run_ended')]);
  await check('NEGATIVE_TIMESTAMP', [event(0, 'run_started'), event(-1, 'steer_left'), event(1000, 'run_ended')]);
  await check('BACKWARD_TIMESTAMP', [event(0, 'run_started'), event(900, 'steer_left'), event(800, 'run_ended')]);
  await check('SERVER_ELAPSED', log(60000));
  // Exactly 600000ms issued TTL. Arrival headroom uses existing elapsed tolerance, never extra playable time.
  await check('TTL_599000', safeLog(599000), 'accepted', 590000);
  await check('TTL_600000', safeLog(600000), 'accepted', 590000);
  await check('TTL_601000', log(601000), 'invalid_timing', 590000);
  const forged = log(1000); forged[1].payload = JSON.stringify({ reason: 'course_complete', duration_ms: 247693237400000, distance_cm: 61923309350000, distance_miles: 384773605.58 });
  const regression = await check('IMPOSSIBLE_SCORE_REGRESSION', forged, 'accepted'); assert.equal(regression.result.data.distance_cm, 500);
  await check('IMPOSSIBLE_TIMELINE_REGRESSION', log(247693237400000));
  await check('EVENT_500', [event(0, 'run_started'), ...Array.from({ length: 498 }, (_, i) => event(i + 1, 'steer_center')), event(1000, 'run_ended')], 'accepted');
  await check('EVENT_501', [event(0, 'run_started'), ...Array.from({ length: 499 }, (_, i) => event(i + 1, 'steer_center')), event(1000, 'run_ended')], 'event_log_too_large');
  await check('EXPIRED_RUN', log(1000), 'run_expired', 610000);
  await check('MISSING_END', [event(0, 'run_started')]);
  await check('EARLY_END', [event(0, 'run_started'), event(100, 'run_ended'), event(200, 'run_ended')]);
  const unauth = await request('/game/start', { node_id: id }); assert.equal(unauth.status, 401); record('AUTHENTICATION', unauth);
  const dupRun = (await start()).data;
  const dupResults = await Promise.all(Array.from({ length: 10 }, () => submit(dupRun, log(1000))));
  assert.equal(dupResults.filter(r => r.status === 200).length, 1);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM game_events WHERE run_id='${dupRun.run_id}'`)[0].n, 2);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM leaderboard WHERE run_id='${dupRun.run_id}'`)[0].n, 1);
  record('CONCURRENT_DUPLICATE', { pass: true, statuses: dupResults.map(r => r.status), accepted: dupResults.find(r => r.status === 200).data });
  const turnstile = await request('/enroll', { turnstile_token: 'invalid', consent_version: 'test' }); assert.equal(turnstile.status, 403); record('TURNSTILE', turnstile);
  const board = await request('/leaderboard'); assert.equal(board.status, 200); assert(board.data.entries.some(e => e.nickname === id)); assert.equal(board.data.stats.best_distance_miles, '1.86'); record('LEADERBOARD', board);
  const stats = await request('/leaderboard/stats'); assert.equal(stats.status, 200); assert.deepEqual(stats.data, board.data.stats); record('STATS', stats);
  const active = await start(), live = await request('/live/current'); assert.equal(live.status, 200); assert(live.data.active_players.some(p => p.run_id === active.data.run_id)); assert(live.data.recent_completions.some(p => p.run_id === short.run.run_id)); assert.equal(live.data.current_leader.distance_miles, '1.86'); record('LIVE', live);
  const invalidRows = sql(`SELECT COUNT(*) AS n FROM game_runs WHERE node_id='${id}' AND status='completed' AND (duration_ms < 0 OR duration_ms > 600000 OR distance_cm < 0 OR distance_cm != duration_ms * 0.5)`);
  assert.equal(invalidRows[0].n, 0);
  record('PERSISTED_SCORE_BOUNDS', { pass: true, invalid_rows: 0 });
  record('MAX_ACCEPTED', { duration_ms: Math.max(...accepted.map(d => d.duration_ms)), distance_cm: Math.max(...accepted.map(d => d.distance_cm)), distance_miles: Math.max(...accepted.map(d => Number(d.distance_miles))) });
  if (process.env.GAME_TEST_EVIDENCE) fs.writeFileSync(process.env.GAME_TEST_EVIDENCE, JSON.stringify(evidence, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
