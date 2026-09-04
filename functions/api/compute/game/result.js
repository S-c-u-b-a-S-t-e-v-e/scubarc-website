import { json, readJson, newId, authenticateNode, clampInt } from "./_lib.js";

function getContestDay() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function generateDailySeed(contestDay) {
  let hash = 0;
  const str = `surf-${contestDay}-genesis-2026`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) >>> 0;
}

function generateCourse(seed) {
  const obstacles = [];
  const random = mulberry32(seed);
  let distanceCm = 0;
  const maxObstacles = 500;
  const baseGap = 200;
  
  for (let i = 0; i < maxObstacles; i++) {
    const lane = Math.floor(random() * 3);
    const gap = baseGap + Math.floor(random() * 300);
    distanceCm += gap * 100;
    const type = Math.floor(random() * 3);
    obstacles.push({
      id: i,
      distance_cm: distanceCm,
      lane,
      type,
      width_cm: 80 + Math.floor(random() * 40)
    });
    
    if (distanceCm > 2000000) break;
  }
  return obstacles;
}

function mulberry32(a) {
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function validateTiming(events) {
  if (events.length === 0) return false;
  let lastTime = 0;
  for (const event of events) {
    if (event.timestamp_ms < lastTime - 1000) return false;
    if (event.timestamp_ms > Date.now() + 60000) return false;
    lastTime = event.timestamp_ms;
  }
  return true;
}

function simulateSurfRun(course, events) {
  let lane = 1;
  let distanceCm = 0;
  let durationMs = 0;
  const speedCmPerMs = 0.5;
  let terminalReason = "timeout";
  
  let eventIdx = 0;
  let nextEventTime = events[0] ? events[0].timestamp_ms : Infinity;
  
  for (const obstacle of course) {
    const timeToObstacle = (obstacle.distance_cm - distanceCm) / speedCmPerMs;
    
    while (eventIdx < events.length && events[eventIdx].timestamp_ms <= durationMs + timeToObstacle) {
      const event = events[eventIdx];
      if (event.event_type === "steer_left") lane = Math.max(0, lane - 1);
      else if (event.event_type === "steer_right") lane = Math.min(2, lane + 1);
      else if (event.event_type === "steer_center") lane = 1;
      eventIdx++;
    }
    
    durationMs += timeToObstacle;
    distanceCm = obstacle.distance_cm;
    
    if (lane === obstacle.lane) {
      terminalReason = "collision";
      break;
    }
  }
  
  if (terminalReason !== "collision") {
    durationMs += (course[course.length - 1]?.distance_cm || 2000000 - distanceCm) / speedCmPerMs;
    distanceCm = Math.max(distanceCm, course[course.length - 1]?.distance_cm || 2000000);
    terminalReason = "course_complete";
  }
  
  return { distanceCm, durationMs, terminalReason };
}

export async function onRequestPost({ request, env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const body = await readJson(request, 65536);
    const node = await authenticateNode(env, request, String(body.node_id || ""));
    if (!node) return json({ error: "unauthorized_node" }, 401);

    const runId = String(body.run_id || "");
    const events = Array.isArray(body.events) ? body.events.slice(0, 500) : [];
    const nickname = String(body.nickname || "").trim().slice(0, 24);

    if (!runId || events.length === 0) return json({ error: "invalid_submission" }, 400);
    if (!validateTiming(events)) return json({ error: "invalid_timing" }, 400);

    const contestDay = getContestDay();
    const dailySeed = generateDailySeed(contestDay);

    const run = await env.COMMUNITY_DB.prepare(
      `SELECT run_id, node_id, contributor_id, seed, game_type, game_version, contest_day, status, expires_at, created_at
       FROM game_runs WHERE run_id = ?1`
    ).bind(runId).first();

    if (!run) return json({ error: "run_not_found" }, 404);
    if (run.node_id !== node.node_id) return json({ error: "run_node_mismatch" }, 403);
    if (run.game_type !== "surf" || run.game_version !== "surf-0.1") return json({ error: "invalid_game_version" }, 400);
    if (run.contest_day !== contestDay) return json({ error: "contest_day_mismatch" }, 400);
    if (run.seed !== dailySeed) return json({ error: "seed_mismatch" }, 400);
    if (run.status !== "active") return json({ error: "run_not_active" }, 409);
    if (new Date(run.expires_at).getTime() < Date.now()) {
      await env.COMMUNITY_DB.prepare("UPDATE game_runs SET status = 'expired' WHERE run_id = ?1").bind(runId).run();
      return json({ error: "run_expired" }, 409);
    }

    const existingEntry = await env.COMMUNITY_DB.prepare("SELECT entry_id FROM leaderboard WHERE run_id = ?1").bind(runId).first();
    if (existingEntry) return json({ error: "duplicate_run_submission" }, 409);

    const course = generateCourse(dailySeed);
    const result = simulateSurfRun(course, events);

    const nowIso = new Date().toISOString();
    const startedAt = run.created_at;
    
    await env.COMMUNITY_DB.batch([
      env.COMMUNITY_DB.prepare(
        `UPDATE game_runs SET status = 'completed', server_score = ?1, distance_cm = ?2, duration_ms = ?3, 
         event_count = ?4, terminal_reason = ?5, completed_at = ?6, started_at = ?7 WHERE run_id = ?8`
      ).bind(result.distanceCm, result.distanceCm, result.durationMs, events.length, result.terminalReason, nowIso, startedAt, runId),
      ...events.map((event, idx) => env.COMMUNITY_DB.prepare(
        `INSERT INTO game_events (event_id, run_id, sequence, timestamp_ms, event_type, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(newId("cge"), runId, idx, event.timestamp_ms, event.event_type, String(event.payload || "{}").slice(0, 500)))
    ]);

    let leaderboardEntry = null;
    if (nickname) {
      const entryId = newId("cle");
      await env.COMMUNITY_DB.prepare(
        `INSERT INTO leaderboard (entry_id, run_id, contributor_id, nickname, game_type, contest_day, server_score, achieved_at, prize_eligible)
         VALUES (?1, ?2, ?3, ?4, 'surf', ?5, ?6, ?7, 1)`
      ).bind(entryId, runId, run.contributor_id, nickname, contestDay, result.distanceCm, nowIso).run();
      leaderboardEntry = { entry_id: entryId, score: result.distanceCm, nickname };
    }

    return json({ 
      distance_cm: result.distanceCm, 
      distance_miles: (result.distanceCm / 160934.4).toFixed(2),
      duration_ms: result.durationMs,
      terminal_reason: result.terminalReason,
      run_id: runId, 
      leaderboard: leaderboardEntry 
    });
  } catch (_) {
    return json({ error: "result_rejected" }, 400);
  }
}