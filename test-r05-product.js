// R05 construction evidence. Requires Playwright and the local D1 server used by
// test-game-timing.js. All browser profiles/artifacts remain under the OS temp dir.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.GAME_TEST_PLAYWRIGHT || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8788';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const read = p => fs.readFileSync(p, 'utf8');
const source = read('commonwealth/surf/game.js');
const resultSource = read('functions/api/compute/game/result.js');
const server = vm.runInNewContext(resultSource.slice(resultSource.indexOf('const OPENING_MS'), resultSource.indexOf('export async')) + '; ({generateDailySeed,generateCourse,obstacleArrivalMs})');
const startSource = read('functions/api/compute/game/start.js');
const startSeed = vm.runInNewContext(startSource.slice(startSource.indexOf('function getContestDay'), startSource.indexOf('export async')) + '; generateDailySeed');
const clientSeed = vm.runInNewContext(source.slice(source.indexOf('  function getContestDay'), source.indexOf('  function mulberry32')) + '; generateDailySeed');
for (const day of ['2026-09-05', '2026-09-06', new Date().toISOString().slice(0,10)]) {
  assert.equal(startSeed(day), server.generateDailySeed(day));
  assert.equal(clientSeed(day), server.generateDailySeed(day));
  let hash = 0;
  for (const char of `surf-${day}-genesis-2026`) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  assert.notEqual(startSeed(day), Math.abs(hash) >>> 0, 'version-separated daily seed');
}
const disclaimer = 'This is an independent Scuba Research Collective initiative and is not a program of or endorsed by the Commonwealth of Virginia.';
const pages = ['commonwealth/index.html', 'commonwealth/surf/index.html', 'commonwealth/leaderboard/index.html', 'commonwealth/compute/index.html', 'compute.html'];
for (const p of pages) assert(read(p).includes(disclaimer), p);
const tracked = execFileSync('git', ['ls-files', '-z'], {encoding:'utf8', windowsHide:true}).split('\0').filter(Boolean);
for (const p of tracked.filter(p => p.endsWith('.html'))) {
  const html = read(p);
  assert(!/href\s*=\s*["'][^"']*\bsurf\.html\b/i.test(html), p + ': legacy navigation');
  assert(!/Daily \$25 Prize|\$25 daily prize|\$25 daily high score/i.test(html), p + ': prize copy');
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) assert(!/<th\b[^>]*>\s*Virginia\s*<\/th>/i.test(table[0]), p);
}
const explanation = read('compute.html');
for (const phrase of ['temporary browser compute node', 'device class', 'platform', 'logical processors', 'WebAssembly support', 'WebGPU availability', 'user-agent string', 'shell access', 'arbitrary code execution authority', 'desktop applications', 'camera/microphone access', 'work_id', 'work_type', 'expires_at', '5,000,000', 'mix32_v1', 'browser Web Worker', 'runtime_ms', 'client_version', 'pseudonymous node credential', 'not a scientific research calculation', 'Genesis Alpha is testing the infrastructure and participation model, not claiming scientific discovery.', 'simulation sweeps', 'parameter searches', 'Monte Carlo', 'numerical analysis', 'model evaluation', 'scientific-validation gates', 'VOLUNTEER DEVICE != TRUSTED DEVICE', 'RETURNED RESULT != AUTHORITATIVE RESULT', 'COMPUTE CONTRIBUTED != AUTHORITY GRANTED', 'classified', 'CUI', 'medical', 'private', 'sensitive']) assert(explanation.includes(phrase), phrase);
for (const p of ['compute.html','commonwealth/compute/index.html']) assert(!read(p).includes('verified research work'));
const lanes = new Set(), types = new Set();
for (const seed of [0,1,42,2147483647,4294967295,server.generateDailySeed(new Date().toISOString().slice(0,10))]) {
  const course = server.generateCourse(seed);
  assert(course.some((o,i) => i > 0 && server.obstacleArrivalMs(course[i-1].distance_cm) > 90000 && server.obstacleArrivalMs(o.distance_cm) - server.obstacleArrivalMs(course[i-1].distance_cm) < 3000));
  let prior = 0;
  for (const o of course) {
    const gap = o.distance_cm - prior;
    assert(gap >= 1500 && gap <= 3000);
    prior = o.distance_cm; lanes.add(o.lane); types.add(o.type);
  }
  assert(server.obstacleArrivalMs(course[0].distance_cm) >= 3000 && server.obstacleArrivalMs(course[0].distance_cm) <= 6000);
  assert(course.filter(o => server.obstacleArrivalMs(o.distance_cm) <= 30000).length >= 5);
  console.log(JSON.stringify({seed, first_arrival_ms:server.obstacleArrivalMs(course[0].distance_cm), arrivals_by_30s:course.filter(o=>server.obstacleArrivalMs(o.distance_cm)<=30000).length, pacing:'PASS'}));
}
assert.deepEqual([...lanes].sort(), [0,1,2]); assert.deepEqual([...types].sort(), [0,1,2]);
function noGeography(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!['virginia','virginia_opt_in','locality'].includes(key)); noGeography(child);
  }
}
async function main() {
  for (const path of ['/leaderboard?tab=today','/leaderboard?tab=week','/leaderboard?tab=all','/live/current']) {
    const r = await fetch(base + '/api/compute' + path); assert.equal(r.status,200);
    noGeography(await r.json());
  }
  const browser = await chromium.launch();
  try {
    // Actual Pages static serving, redirects, CSP and the unmodified entry script.
    const context = await browser.newContext();
    const page = await context.newPage();
    let starts = 0, legacyGameplay = 0;
    page.on('request', req => {
      if (req.url().includes('/game/start')) starts++;
      if (new URL(req.url()).pathname === '/api/compute/leaderboard' || req.url().endsWith('/surf.css')) legacyGameplay++;
    });
    for (const [value,expected] of [['bar','bar'],['shared','shared'],['scubarc','scubarc'],['direct','direct'],['evil','direct'],['','direct']]) {
      await page.goto(base + '/surf.html' + (value ? '?src='+value : ''));
      await page.waitForURL(url => /^\/commonwealth\/surf\/?$/.test(url.pathname) && url.searchParams.get('src') === expected);
      assert.equal(await page.locator('canvas').count(),0);
      assert.equal(await page.locator('#surf-nickname').count(),1);
      assert.equal(starts,0); assert.equal(legacyGameplay,0);
    }
    await page.goto(base + '/compute.html');
    await page.getByRole('link', {name:'Play Commonwealth Surf',exact:true}).click();
    assert(/^\/commonwealth\/surf\/?$/.test(new URL(page.url()).pathname));
    assert.equal(starts,0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('scubarc_cc_node_token')),null);
    await page.goto(base + '/commonwealth/surf/game.html?src=bar');
    await page.waitForFunction(()=>document.querySelector('.subtitle').textContent.includes('Return to Surf entry'));
    assert.equal(starts,0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('scubarc_cc_node_token')),null);
    await context.close();
    console.log('LEGACY_REDIRECT_AND_FRESH_ENTRY PASS');

    // Isolated local verification fixture: real form and handoff; no production bypass.
    const fixture = await browser.newContext({viewport:{width:390,height:1000}});
    const game = await fixture.newPage();
    let enrolled = false, gameStarts = 0, result;
    let serverVersion = 'surf-0.2';
    await game.route(base + '/compute-config.js', route => route.fulfill({contentType:'text/javascript',body:'window.SCUBARC_COMPUTE_CONFIG={apiBase:"/api/compute",turnstileSiteKey:"local-fixture"};'}));
    await game.route('https://challenges.cloudflare.com/**', route => route.fulfill({contentType:'text/javascript',body:'window.turnstile={render:(selector,opts)=>{window.completeFixtureVerification=()=>opts.callback("local-verified-token");return 1;},reset:()=>{}};'}));
    await game.route(base + '/api/compute/enroll', async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.turnstile_token,'local-verified-token');
      assert.equal(body.consent_version,'commonwealth-surf-v0'); assert.equal(body.display_name,'R05 Surfer');
      assert(await game.locator('input[name="consent"]').isChecked());
      enrolled = true;
      await route.fulfill({json:{node_id:'r05-fixture',node_token:'r05-token'}});
    });
    await game.route(base + '/api/compute/game/start', async route => {
      assert(enrolled); assert.equal(route.request().headers().authorization,'Bearer r05-token');
      gameStarts++;
      await route.fulfill({json:{run_id:'r05-run',seed:42,remaining_ms:600000,game_version:serverVersion,client_version:'cc-game-alpha-0.2',contest_day:new Date().toISOString().slice(0,10)}});
    });
    await game.route(base + '/api/compute/game/result', async route => {
      result = route.request().postDataJSON();
      await route.fulfill({json:{distance_miles:'0.01'}});
    });
    // Read-only observation of state and actual canvas commands. Real performance.now/RAF.
    await game.route(base + '/commonwealth/surf/game.js', route => route.fulfill({contentType:'text/javascript',body:source.replace('  if (document.readyState === "loading")','  window.r05State = () => ({surfer,course,obstacles,distanceCm,running,events});\n  if (document.readyState === "loading")')}));
    await game.addInitScript(() => {
      window.r05Frames = [];
      const proto = CanvasRenderingContext2D.prototype;
      const clear = proto.clearRect, move = proto.moveTo, translate = proto.translate;
      proto.clearRect = function(...args) { window.r05Draw = {time:performance.now(),rocks:[]}; return clear.apply(this,args); };
      proto.moveTo = function(x,y) { if(this.fillStyle === '#78716c') window.r05Draw.rocks.push({x,y}); return move.call(this,x,y); };
      proto.translate = function(x,y) { if(window.r05Draw) {window.r05Draw.surfer={x,y}; window.r05Frames.push(window.r05Draw);} return translate.call(this,x,y); };
    });
    await game.goto(base + '/commonwealth/?src=bar');
    await game.getByRole('link',{name:'PLAY COMMONWEALTH SURF',exact:true}).first().click();
    assert.equal(gameStarts,0); assert(!enrolled);
    await game.locator('#surf-start').click();
    assert.equal(gameStarts,0); assert(!enrolled);
    await game.locator('#surf-nickname').fill('R05 Surfer');
    await game.locator('#surf-start').click();
    assert.equal(gameStarts,0); assert(!enrolled);
    await game.locator('input[name="consent"]').check();
    await game.locator('#surf-start').click();
    await game.waitForFunction(()=>typeof window.completeFixtureVerification === 'function');
    assert.equal(gameStarts,0); assert(!enrolled);
    await game.evaluate(()=>window.completeFixtureVerification());
    await game.locator('#surf-start').click();
    await game.waitForURL(url=>/\/game(?:\.html)?$/.test(url.pathname));
    assert.equal(new URL(game.url()).searchParams.get('src'),'bar');
    await game.waitForFunction(()=>window.r05State?.().running);
    assert.equal(gameStarts,1);
    const initial = await game.evaluate(()=>({state:window.r05State(),frame:window.r05Frames[0]}));
    const rock = initial.frame.rocks[0], surfer = initial.frame.surfer;
    assert(rock && rock.y > 0, 'first obstacle visibly rendered at initial frame');
    assert(rock.y + 60 < surfer.y - initial.state.surfer.height/2, 'initial obstacle overlaps surfer');
    assert.equal(initial.state.course[0].type,'rock'); assert.equal(initial.state.course[0].lane,1);
    // Normal wall-clock time: observe hundreds of browser frames through the first arrival.
    await game.waitForFunction(()=>window.r05State && !window.r05State().running, null, {timeout:10000});
    const observed = await game.evaluate(()=>({frames:window.r05Frames,state:window.r05State()}));
    assert(observed.frames.length > 30, 'early window must execute real animation frames');
    const middle = observed.frames.find(f=>f.time-initial.frame.time>=1000);
    assert(middle && middle.rocks[0].y > rock.y, 'first obstacle approaches during ordinary browser time');
    const final = observed.frames.at(-1);
    assert(Math.abs(final.rocks[0].y + 20 - final.surfer.y)<0.001, 'render/collision arrival center');
    assert.equal(observed.state.distanceCm,server.generateCourse(42)[0].distance_cm);
    assert(final.time-initial.frame.time>=3000 && final.time-initial.frame.time<7000);
    await game.waitForFunction(()=>document.querySelector('#result-note').textContent !== 'Submitting run to server for verification...');
    assert.equal(result.nickname,'R05 Surfer');
    assert.equal(JSON.parse(result.events.at(-1).payload).reason,'collision');
    console.log(JSON.stringify({human_window:'PASS',frames:observed.frames.length,elapsed_ms:final.time-initial.frame.time,first_y:rock.y,middle_y:middle.rocks[0].y,arrival_center_y:final.rocks[0].y+20}));
    serverVersion = 'surf-0.1';
    result = undefined;
    await game.reload();
    await game.waitForFunction(()=>document.querySelector('.subtitle').textContent.includes('unexpected_game_version'));
    assert.equal(await game.evaluate(()=>window.r05State().running),false); assert.equal(result,undefined);
    await fixture.close();
    console.log('CANONICAL_ENTRY_VERSION_REJECTION_COPY_PRIVACY PASS');
  } finally { await browser.close(); }
  console.log('R05_PRODUCT_TESTS PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
