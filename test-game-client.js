// Executes the actual client closure with controlled DOM, monotonic clock, and timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function scenario(remaining, delay, trigger) {
  let clock = 100, timer, frame, submitted, submits = 0;
  const element = { classList: { toggle() {}, remove() {} }, getContext: () => new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }), addEventListener() {}, querySelector() { return this; } };
  const storage = { getItem: key => ({ scubarc_cc_node_id: 'fixture', scubarc_cc_node_token: 'token', commonwealth_nickname: 'Test' }[key] || ''), setItem() {} };
  const context = {
    window: { devicePixelRatio: 1 }, document: { readyState: 'loading', getElementById: () => element, addEventListener() {} },
    localStorage: storage, sessionStorage: storage, performance: { now: () => clock },
    setTimeout: (fn, ms) => { timer = { fn, ms }; return 1; }, clearTimeout() {},
    requestAnimationFrame: fn => { frame = fn; return 1; }, cancelAnimationFrame() {},
    fetch: async (url, opts) => {
      if (url.endsWith('/game/start')) { clock += delay; return { ok: true, json: async () => ({ run_id: 'run', game_version: 'surf-0.2', client_version: 'cc-game-alpha-0.2', seed: 42, remaining_ms: remaining, expires_at: '2000-01-01', reused: remaining < 600000 }) }; }
      submits++; submitted = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ distance_miles: '0.00', leaderboard: {} }) };
    }
  };
  let src = fs.readFileSync('commonwealth/surf/game.js', 'utf8');
  src = src.replace('  if (document.readyState === "loading")', '  window.test = { startGameRun, handleSteer };\n  if (document.readyState === "loading")');
  vm.runInNewContext(src, context);
  await context.window.test.startGameRun();
  const playable = Math.max(0, remaining - delay - 5000);
  assert.equal(timer.ms, playable);
  if (trigger === 'events') {
    clock += 10;
    for (let i = 0; i < 499; i++) context.window.test.handleSteer('center');
    assert.equal(submitted.events.length, 500);
  } else {
    clock += playable + (trigger === 'late' ? 10000 : 0);
    if (trigger === 'frame') frame(clock); else timer.fn();
    assert.equal(submitted.events.at(-1).timestamp_ms, playable);
  }
  await Promise.resolve();
  assert.equal(submits, 1);
  assert.equal(submitted.events[0].event_type, 'run_started');
  assert.equal(submitted.events.at(-1).event_type, 'run_ended');
  console.log(JSON.stringify({ remaining_ms: remaining, request_ms: delay, trigger, end_ms: submitted.events.at(-1).timestamp_ms, events: submitted.events.length, pass: true }));
}
(async () => {
  await scenario(600000, 100, 'timer');
  await scenario(9000, 250, 'timer');
  await scenario(9000, 250, 'frame');
  await scenario(9000, 250, 'late');
  await scenario(3000, 100, 'timer');
  await scenario(600000, 100, 'events');
})().catch(e => { console.error(e); process.exitCode = 1; });
