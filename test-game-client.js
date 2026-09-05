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

// Independent checkpoint oracle, plus identical client/server mathematics.
const modelNames = '({speedAtElapsedMs,distanceAtElapsedMs,elapsedMsAtDistanceCm,obstacleArrivalMs})';
const clientSource = fs.readFileSync('commonwealth/surf/game.js','utf8');
const serverSource = fs.readFileSync('functions/api/compute/game/result.js','utf8');
const models = [clientSource,serverSource].map(s => vm.runInNewContext(
  s.slice(s.indexOf('const OPENING_MS'),s.indexOf('function getContestDay')) + ';' + modelNames));
const close = (a,b) => assert(Math.abs(a-b) < 1e-7, `${a} != ${b}`);
for (const model of models) {
  for (const [t,s,d] of [[0,.5,0],[6000,.5,3000],[30000,.7,17400],[60000,.95,42150],[90000,1.2,74400],[120000,1.2,110400]]) {
    close(model.speedAtElapsedMs(t),s); close(model.distanceAtElapsedMs(t),d);
  }
  for (const t of [0,1,2999,6000,6001,30000,60000,89999,90000,90001,120000,300000]) {
    close(model.elapsedMsAtDistanceCm(model.distanceAtElapsedMs(t)),t);
  }
  for (const d of [0,1,2999,3000,3000.001,3001,74399,74400,74400.001,74401,110400,326400]) {
    close(model.distanceAtElapsedMs(model.elapsedMsAtDistanceCm(d)),d);
    assert.equal(model.obstacleArrivalMs(d),Math.ceil(model.elapsedMsAtDistanceCm(d)));
  }
  let previous = .5;
  for (let t=0;t<=300000;t++) {
    const speed = model.speedAtElapsedMs(t);
    assert(speed >= previous && speed <= 1.2);
    if(t<=6000) assert.equal(speed,.5);
    if(t>6000 && t<90000) assert(speed>.5 && speed<1.2);
    if(t>=90000) assert.equal(speed,1.2);
    previous=speed;
    assert.equal(speed,models[0].speedAtElapsedMs(t));
    assert.equal(model.distanceAtElapsedMs(t),models[0].distanceAtElapsedMs(t));
  }
  close(model.elapsedMsAtDistanceCm(75900)-90000,1250);
  close(model.elapsedMsAtDistanceCm(77400)-90000,2500);
}
const replay = vm.runInNewContext(serverSource.slice(serverSource.indexOf('const OPENING_MS'),serverSource.indexOf('export async'))+'; simulateSurfRun');
for (const distance_cm of [17401,42151,74401,110401]) {
  const arrival = models[0].obstacleArrivalMs(distance_cm);
  for (const offset of [-1,0,1]) {
    const events = [{timestamp_ms:0,event_type:'run_started'}, {timestamp_ms:arrival+offset,event_type:'steer_right'}, {timestamp_ms:arrival+10,event_type:'run_ended'}];
    const result = replay([{distance_cm,lane:2},{distance_cm:distance_cm+3000,lane:0}],events);
    assert.equal(result.terminalReason,offset<=0?'collision':'timeout');
    assert.equal(result.distanceCm,offset<=0?distance_cm:models[0].distanceAtElapsedMs(arrival+10));
    assert.equal(result.durationMs,offset<=0?arrival:arrival+10);
  }
  const course = [{distance_cm,lane:0}];
  const result = replay(course,[{timestamp_ms:0,event_type:'run_started'},{timestamp_ms:arrival+10,event_type:'run_ended'}]);
  assert.equal(result.terminalReason,'course_complete'); assert.equal(result.distanceCm,distance_cm); assert.equal(result.durationMs,arrival);
}
console.log('PROGRESSIVE_MODEL_CHECKPOINTS_INVERSE_CAP_CADENCE_ORDERING PASS');
