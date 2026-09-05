// Run with Node and Playwright installed (or set GAME_TEST_PLAYWRIGHT to its module path).
// Real Chromium layout, canvas drawing and keyboard/touch input; local API fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require(process.env.GAME_TEST_PLAYWRIGHT || 'playwright');
const source = fs.readFileSync('commonwealth/surf/game.js', 'utf8');
const serverSource = fs.readFileSync('functions/api/compute/game/result.js', 'utf8');
const server = vm.runInNewContext(serverSource.slice(serverSource.indexOf('const OPENING_MS'),
  serverSource.indexOf('export async')) + '; ({ generateCourse, simulateSurfRun, obstacleArrivalMs })');
const hook = `
  window.laneTest = {
    state: () => ({ surfer: {...surfer}, course, obstacles, distanceCm, running, events }),
    // Reset only the isolated fixture; production rejects overlapping starts.
    startGameRun: async () => {
      clearTimeout(expiryTimer); clearTimeout(leaderboardTimer);
      running = false; gameState = "menu";
      await startGameRun();
    }, generateCourse,
    clockAt: ms => { window.testClock = startTime + ms; },
    frameAt: ms => { window.testClock = startTime + ms; gameLoop(window.testClock); },
    tick: (ms = 0) => { window.testClock += ms; gameLoop(window.testClock); }
  };
`;
async function main() {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 820, 1440]) {
      for (const dpr of [1, 2]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: dpr, hasTouch: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const submissions = [];
        let seed = 880377089; // Observed contest day: 2026-09-05.
        await page.route('http://game.test/**', async route => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/compute/game/start') {
            assert.equal(route.request().headers().authorization, 'Bearer fixture-token');
            return route.fulfill({ json: { run_id: 'fixture-run', game_version: 'surf-0.2', client_version: 'cc-game-alpha-0.2', seed, remaining_ms: 600000, contest_day: '2026-09-05' } });
          }
          if (path === '/api/compute/game/result') {
            assert.equal(route.request().headers().authorization, 'Bearer fixture-token');
            submissions.push(route.request().postDataJSON());
            return route.fulfill({ json: { distance_miles: '0.00' } });
          }
          const file = '.' + path;
          if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
          const body = path.endsWith('/game.js')
            ? source.replace('  if (document.readyState === "loading")', hook + '  if (document.readyState === "loading")')
            : fs.readFileSync(file, 'utf8');
          return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
        });
        await page.addInitScript(() => {
          localStorage.setItem('scubarc_cc_node_id', 'fixture-node');
          localStorage.setItem('scubarc_cc_node_token', 'fixture-token');
          sessionStorage.setItem('commonwealth_nickname', 'Lane Test');
          sessionStorage.setItem('commonwealth_src', 'direct');
          window.testClock = 100;
          performance.now = () => window.testClock;
          window.requestAnimationFrame = () => 1;
          window.cancelAnimationFrame = () => {};
          // Record actual canvas draw coordinates, including the applied DPR transform.
          window.draws = [];
          for (const name of ['translate', 'moveTo', 'arc', 'rect']) {
            const original = CanvasRenderingContext2D.prototype[name];
            CanvasRenderingContext2D.prototype[name] = function(...args) {
              window.draws.push({ name, args, color: this.fillStyle, scale: this.getTransform().a });
              return original.apply(this, args);
            };
          }
        });
        await page.goto('http://game.test/commonwealth/surf/game.html?src=direct');
        await page.waitForFunction(() => window.laneTest?.state().running);
        const state = () => page.evaluate(() => window.laneTest.state());
        const tick = (ms = 0) => page.evaluate(ms => { window.draws = []; window.laneTest.tick(ms); }, ms);
        const rect = await page.locator('canvas').boundingBox();
        assert(rect.width <= width && rect.width > 0);
        const lane = async expected => {
          await page.evaluate(() => {
            for (let i = 0; i < 120; i++) { window.draws = []; window.laneTest.tick(); }
          });
          const s = await state();
          assert(s.running, `run stopped before reaching lane ${expected}`);
          assert.equal(s.surfer.targetLane, expected);
          assert(Math.abs(s.surfer.lane - expected) < 0.000001, `surfer did not reach lane ${expected}: ${s.surfer.lane}`);
          const draw = await page.evaluate(() => window.draws.find(d => d.name === 'translate'));
          const expectedX = Math.floor(rect.width * dpr) / dpr / 3 * (expected + 0.5);
          assert(Math.abs(draw.args[0] - expectedX) < 0.001);
          assert.equal(draw.scale, dpr);
          assert(draw.args[0] - s.surfer.width / 2 >= 0);
          assert(draw.args[0] + s.surfer.width / 2 <= rect.width);
        };
        await tick(16);
        await lane(1);
        // Reproduce the reported right-lane rock with the actual generated course.
        console.log(JSON.stringify({ width, dpr, firstObstacle: (await state()).course[0] }));
        for (const [key, expected] of [['ArrowLeft', 0], ['ArrowRight', 1], ['ArrowRight', 2], ['ArrowLeft', 1], ['ArrowLeft', 0]]) {
          await page.keyboard.press(key); await lane(expected);
        }
        for (const [key, expected] of [['ArrowRight', 2], ['ArrowLeft', 0], ['d', 2], ['a', 0]]) {
          for (let i = 0; i < 12; i++) { await page.keyboard.press(key); await tick(16); }
          await lane(expected);
        }
        // Touchscreen taps must actually hit the canvas, not a hidden overlay.
        await page.locator('canvas').scrollIntoViewIfNeeded();
        const touchRect = await page.locator('canvas').boundingBox();
        for (const [third, expected] of [[1, 1], [2, 2], [2, 2], [0, 1], [0, 0], [0, 0], [1, 1]]) {
          await page.touchscreen.tap(touchRect.x + touchRect.width / 3 * (third + 0.5), touchRect.y + 80);
          await lane(expected);
        }
        // Generated destinations, normalization and determinism, never hand-invented lanes.
        const courses = await page.evaluate(() => [0, 1, 42, 2147483647, 4294967295].map(seed => {
          const a = window.laneTest.generateCourse(seed), b = window.laneTest.generateCourse(seed);
          if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('nondeterministic course');
          return a;
        }));
        for (const course of courses) {
          assert.deepEqual([...new Set(course.map(o => o.lane))].sort(), [0, 1, 2]);
          assert(course.every(o => Number.isInteger(o.lane) && o.lane >= 0 && o.lane <= 2));
        }
        // Each obstacle type in each lane: real generated first obstacle, real input,
        // distant non-collision, visible approach, arrival collision and submitted reason.
        for (const expected of [0, 1, 2]) {
          for (const type of ['rock', 'buoy', 'debris']) {
            seed = await page.evaluate(({ expected, type }) => {
              for (let seed = 0; seed < 10000; seed++) {
                const first = window.laneTest.generateCourse(seed)[0];
                if (first.lane === expected && first.type === type) return seed;
              }
              throw Error('missing generated destination');
            }, { expected, type });
            await page.evaluate(() => window.laneTest.startGameRun());
            if (expected !== 1) await page.keyboard.press(expected === 0 ? 'ArrowLeft' : 'ArrowRight');
            await lane(expected);
            const first = (await state()).course[0];
            await tick(first.distance_cm * 2 - 1000);
            assert((await state()).running, 'distant obstacle caused premature collision');
            const before = await page.evaluate(() => ({ draws: window.draws, state: window.laneTest.state() }));
            const color = { rock: '#78716c', buoy: '#0ea5e9', debris: '#f97316' }[type];
            const approach = before.draws.find(d => d.color === color && ['moveTo', 'arc', 'rect'].includes(d.name));
            assert(approach, 'obstacle not rendered');
            await tick(1000);
            assert.equal((await state()).running, false, `missing ${type} collision in lane ${expected}`);
            const draws = await page.evaluate(() => window.draws);
            const surferDraw = draws.find(d => d.name === 'translate');
            const obstacleDraw = draws.find(d => d.color === color && ['moveTo', 'arc', 'rect'].includes(d.name));
            const obstacleX = obstacleDraw.args[0] + (type === 'debris' ? obstacleDraw.args[2] / 2 : 0);
            const obstacleY = obstacleDraw.args[1] + (type === 'rock' ? 20 : type === 'debris' ? obstacleDraw.args[3] / 2 : 0);
            assert(Math.abs(obstacleX - surferDraw.args[0]) < 0.001, 'rendered collision lane disagrees');
            assert(Math.abs(obstacleY - surferDraw.args[1]) < 0.001, 'rendered collision arrival disagrees');
            assert(approach.args[1] < obstacleDraw.args[1], 'obstacle did not approach');
            await page.waitForFunction(() => document.getElementById('result-note').textContent !== 'Submitting run to server for verification...', null, { polling: 10 });
            assert.equal(JSON.parse(submissions.at(-1).events.at(-1).payload).reason, 'collision');
            assert.equal(submissions.at(-1).nickname, 'Lane Test');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('commonwealth_src')), 'direct');
            // The same generated obstacle must be avoidable in a different lane.
            await page.evaluate(() => window.laneTest.startGameRun());
            if (expected === 1) await page.keyboard.press('ArrowLeft');
            await tick(first.distance_cm * 2 + 1000);
            assert((await state()).running, 'collision in an unoccupied lane');
            // Skipping over arrival in one frame must still collide, at the drawn center.
            await page.evaluate(() => window.laneTest.startGameRun());
            if (expected !== 1) await page.keyboard.press(expected === 0 ? 'ArrowLeft' : 'ArrowRight');
            await tick(first.distance_cm * 2 + 2000);
            assert.equal((await state()).running, false, 'delayed frame skipped collision');
            assert.equal((await state()).distanceCm, first.distance_cm);
            await page.waitForFunction(() => document.getElementById('result-note').textContent !== 'Submitting run to server for verification...', null, { polling: 10 });
          }
        }
        // Run real input handlers with a clock independent of rendering, then compare
        // actual client outcomes to the unmodified authoritative server replay.
        seed = Array.from({ length: 10000 }, (_, i) => i).find(s => {
          const first = server.generateCourse(s)[0];
          return first.lane === 2 && first.distance_cm * 2 === 4800;
        });
        assert.notEqual(seed, undefined, 'missing generated 4800ms lane-2 fixture');
        const generated = JSON.parse(JSON.stringify(server.generateCourse(seed)));
        const arrival = generated[0].distance_cm * 2;
        assert.equal(arrival, 4800);
        assert.equal(generated[0].lane, 2);
        const parity = async (name, inputs, frames, collisionIndex = null) => {
          await page.evaluate(() => window.laneTest.startGameRun());
          assert.deepEqual((await state()).course.map(o => ({ ...o, type: ['buoy', 'rock', 'debris'].indexOf(o.type) })), generated);
          const actions = [...inputs.map(([ms, key]) => ({ ms, key })), ...frames.map(ms => ({ ms }))]
            .sort((a, b) => a.ms - b.ms || Number(!a.key) - Number(!b.key));
          for (const action of actions) {
            if (!(await state()).running) break;
            if (action.key) {
              await page.evaluate(ms => window.laneTest.clockAt(ms), action.ms);
              await page.keyboard.press(action.key);
            } else await page.evaluate(ms => window.laneTest.frameAt(ms), action.ms);
          }
          const actual = await state();
          const collision = collisionIndex !== null;
          assert.equal(!actual.running, collision, `${name}: client collision`);
          const recordedInputs = actual.events.filter(e => e.event_type.startsWith('steer_'));
          const keyTypes = { ArrowLeft: 'steer_left', ArrowRight: 'steer_right', Space: 'steer_center' };
          assert.deepEqual(recordedInputs.map(e => [e.timestamp_ms, e.event_type]),
            inputs.map(([ms, key]) => [ms, keyTypes[key]]), `${name}: recorded input timeline`);
          const replayEvents = collision ? actual.events : [...actual.events,
            { timestamp_ms: frames.at(-1), event_type: 'run_ended', payload: '{}' }];
          const replay = server.simulateSurfRun(generated, replayEvents);
          assert.equal(replay.terminalReason === 'collision', collision, `${name}: server collision`);
          // Fractional RAF times lose a few ulps when adding/subtracting the clock origin.
          if (collision) assert.equal(actual.distanceCm, replay.distanceCm, `${name}: exact collision distance`);
          else assert(Math.abs(actual.distanceCm - replay.distanceCm) < 1e-7, `${name}: client/server distance`);
          if (collision) {
            assert.equal(actual.distanceCm, generated[collisionIndex].distance_cm, `${name}: first collision`);
            await page.waitForFunction(() => document.getElementById('result-note').textContent !== 'Submitting run to server for verification...', null, { polling: 10 });
            assert.deepEqual(submissions.at(-1).events, actual.events, `${name}: submitted timeline`);
            assert.equal(JSON.parse(actual.events.at(-1).payload).reason, 'collision');
          }
          console.log(JSON.stringify({ width, dpr, parity: name, pass: true, distanceCm: actual.distanceCm }));
        };
        for (const offset of [-1, 0, 1]) {
          await parity(`entry_${offset}ms`, [[arrival + offset, 'ArrowRight']],
            [arrival - 2000, arrival + 2000], offset <= 0 ? 0 : null);
          await parity(`exit_${offset}ms`, [[0, 'ArrowRight'], [arrival + offset, 'Space']],
            [arrival - 2000, arrival + 2000], offset <= 0 ? null : 0);
        }
        await parity('late_entry_1000ms', [[arrival + 1000, 'ArrowRight']], [arrival - 2000, arrival + 2000]);
        await parity('late_exit_1000ms', [[0, 'ArrowRight'], [arrival + 1000, 'ArrowLeft']], [arrival - 2000, arrival + 2000], 0);
        await parity('enter_before_exit_after', [[arrival - 1, 'ArrowRight'], [arrival + 1, 'ArrowLeft']], [arrival - 2000, arrival + 2000], 0);
        await parity('equal_timestamp_order_avoid', [[arrival, 'ArrowRight'], [arrival, 'Space']], [arrival - 1, arrival + 1]);
        await parity('equal_timestamp_order_collide', [[arrival, 'Space'], [arrival, 'ArrowRight'], [arrival, 'ArrowRight']], [arrival - 1, arrival + 1], 0);
        // Cross three arrivals in a single update. Choose lanes from the real course
        // to avoid each preceding obstacle, then collide with the selected one.
        for (const collisionIndex of [0, 1, 2, null]) {
          const inputs = [];
          for (let i = 0; i < 3; i++) {
            const o = generated[i], ms = server.obstacleArrivalMs(o.distance_cm) - 1;
            const lane = i === collisionIndex ? o.lane : (o.lane + 1) % 3;
            inputs.push([ms, 'Space']);
            if (lane !== 1) inputs.push([ms, lane === 0 ? 'ArrowLeft' : 'ArrowRight']);
          }
          await parity(`multiple_arrivals_first_collision_${collisionIndex}`, inputs,
            [arrival - 2000, server.obstacleArrivalMs(generated[2].distance_cm) + 2000], collisionIndex);
        }
        // Ordinary 60-FPS rendering around arrival, including steering between frames.
        const frames = Array.from({ length: 121 }, (_, i) => arrival - 1000 + i * (1000 / 60));
        await parity('60fps_collision', [[arrival - 1, 'ArrowRight']], frames, 0);
        await parity('60fps_avoidance', [[arrival + 1, 'ArrowRight']], frames);
        // Generated ramp/capped arrivals, with real input and delayed versus regular frames.
        for (const targetMs of [30000,60000,90001,120000]) {
          const index = generated.findIndex(o => server.obstacleArrivalMs(o.distance_cm) >= targetMs);
          const target = generated[index], at = server.obstacleArrivalMs(target.distance_cm);
          const prefix = [];
          for (let i=0;i<index;i++) {
            const ms=server.obstacleArrivalMs(generated[i].distance_cm)-1;
            const lane=(generated[i].lane+1)%3;
            prefix.push([ms,'Space']);
            if(lane!==1) prefix.push([ms,lane===0?'ArrowLeft':'ArrowRight']);
          }
          for (const offset of [-1,0,1]) {
            const safe=(target.lane+1)%3;
            const inputs=[...prefix,[at-2,'Space']];
            if(safe!==1) inputs.push([at-2,safe===0?'ArrowLeft':'ArrowRight']);
            inputs.push([at+offset,'Space']);
            if(target.lane!==1) inputs.push([at+offset,target.lane===0?'ArrowLeft':'ArrowRight']);
            await parity(`progressive_${targetMs}_entry_${offset}`,inputs,[at+10],offset<=0?index:null);
          }
          const avoid=[...prefix,[at-1,'Space']];
          const safe=(target.lane+1)%3;
          if(safe!==1) avoid.push([at-1,safe===0?'ArrowLeft':'ArrowRight']);
          await parity(`progressive_${targetMs}_single_frame`,avoid,[at+10]);
          await parity(`progressive_${targetMs}_60fps`,avoid,
            [...Array.from({length:61},(_,i)=>at-1000+i*1000/60),at+10]);
          // Fractional physical crossing must wait for the integer event boundary.
          await parity(`progressive_${targetMs}_before_integer`,prefix,[at-0.01]);
        }
        // Resize while occupying every lane; inspect both state and real drawing.
        await page.evaluate(() => window.laneTest.startGameRun());
        for (const [key, expected] of [['ArrowLeft', 0], ['Space', 1], ['ArrowRight', 2]]) {
          await page.keyboard.press(key); await tick();
          await page.setViewportSize({ width: width - 30, height: 950 });
          await page.evaluate(() => window.dispatchEvent(new Event('resize')));
          await tick();
          const resized = await state();
          const canvasWidth = await page.evaluate(() => document.querySelector('canvas').width / window.devicePixelRatio);
          assert.equal(resized.surfer.lane, expected);
          assert.equal(resized.surfer.targetLane, expected);
          assert(Math.abs(resized.surfer.x + resized.surfer.width / 2 - canvasWidth / 3 * (expected + 0.5)) < 0.001);
          const draw = await page.evaluate(() => window.draws.find(d => d.name === 'translate'));
          assert(Math.abs(draw.args[0] - canvasWidth / 3 * (expected + 0.5)) < 0.001);
          await page.setViewportSize({ width, height: 1000 });
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, dpr, keyboard: 'PASS', touch: 'PASS', clamping: 'PASS', lanes: [0, 1, 2], collisions: 'PASS' }));
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
