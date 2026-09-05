"use strict";

(() => {
  const config = window.SCUBARC_COMPUTE_CONFIG || { apiBase: "/api/compute", turnstileSiteKey: "" };
  const canvas = document.getElementById("surf-canvas");
  const ctx = canvas.getContext("2d");
  const gameUI = document.getElementById("game-ui");
  const gameOverlay = document.getElementById("game-overlay");
  const overlayContent = document.getElementById("overlay-content");
  const nicknameForm = document.getElementById("nickname-form");
  const nicknameInput = document.getElementById("nickname-input");
  const resultDisplay = document.getElementById("result-display");
  const resultDistance = document.getElementById("result-distance");
  const resultReason = document.getElementById("result-reason");
  const resultNote = document.getElementById("result-note");
  const playAgainBtn = document.getElementById("play-again");
  const viewLeaderboardBtn = document.getElementById("view-leaderboard");
  const hudDistance = document.getElementById("hud-distance");
  const hudContest = document.getElementById("hud-contest");

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;
  let running = false;
  let gameState = "menu";
  let currentRun = null;
  let events = [];
  let startTime = 0;
  let lastFrameTime = 0;
  let playableMs = 0;
  let expiryTimer = null;
  let surfer = { lane: 1, targetLane: 1, y: 0, x: 0, width: 0, height: 0 };
  let obstacles = [];
  let course = [];
  let distanceCm = 0;
  let speedCmPerMs = 0.5;
  let animationId = null;
  let nodeToken = "";
  let nodeId = "";
  let sessionSrc = "";

  const LANES = 3;
  const LANE_COLORS = ["#4ecdc4", "#ff6b6b", "#ffe66d"];
  const OBSTACLE_TYPES = ["buoy", "rock", "debris"];
  const OBSTACLE_COLORS = {
    buoy: "#0ea5e9",
    rock: "#78716c",
    debris: "#f97316"
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.floor(rect.width * dpr);
    height = Math.floor(rect.height * dpr);
    canvas.width = width;
    canvas.height = height;
    ctx.scale(dpr, dpr);

    surfer.width = rect.width / LANES * 0.6;
    surfer.height = surfer.width * 1.5;
    surfer.x = (canvas.width / dpr) / LANES * (surfer.lane + 0.5) - surfer.width / 2;
    surfer.y = rect.height - surfer.height - 40;
  }

  function getContestDay() {
    return new Date().toISOString().slice(0, 10);
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

  function mulberry32(a) {
    return function() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
        type: OBSTACLE_TYPES[type],
        width_cm: 80 + Math.floor(random() * 40)
      });

      if (distanceCm > 2000000) break;
    }
    return obstacles;
  }

  async function api(path, options = {}) {
    const response = await fetch(`${config.apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
    return body;
  }

  async function getNodeCredentials() {
    const existingNodeId = localStorage.getItem("scubarc_cc_node_id") || "";
    const existingNodeToken = localStorage.getItem("scubarc_cc_node_token") || "";
    if (existingNodeId && existingNodeToken) {
      nodeId = existingNodeId;
      nodeToken = existingNodeToken;
      return { node_id: existingNodeId, node_token: existingNodeToken, reused: true };
    }
    return null;
  }

  function readSessionStorage() {
    try {
      const nickname = sessionStorage.getItem("commonwealth_nickname") || "";
      const src = sessionStorage.getItem("commonwealth_src") || "direct";
      const runId = sessionStorage.getItem("commonwealth_run_id") || "";
      const verifiedDistance = sessionStorage.getItem("commonwealth_verified_distance") || "";
      return { nickname, src, runId, verifiedDistance };
    } catch (_) {
      return { nickname: "", src: "direct", runId: "", verifiedDistance: "" };
    }
  }

  function writeSessionStorage(data) {
    try {
      if (data.nickname) sessionStorage.setItem("commonwealth_nickname", data.nickname);
      if (data.src) sessionStorage.setItem("commonwealth_src", data.src);
      if (data.runId) sessionStorage.setItem("commonwealth_run_id", data.runId);
      if (data.verifiedDistance) sessionStorage.setItem("commonwealth_verified_distance", data.verifiedDistance);
    } catch (_) {}
  }

  function clearSessionStorage() {
    try {
      sessionStorage.removeItem("commonwealth_nickname");
      sessionStorage.removeItem("commonwealth_src");
      sessionStorage.removeItem("commonwealth_run_id");
      sessionStorage.removeItem("commonwealth_verified_distance");
    } catch (_) {}
  }

  async function startGameRun() {
    const credentials = await getNodeCredentials();
    if (!credentials) {
      showError("Please complete Compute enrollment first to get a node token.");
      return;
    }
    nodeId = credentials.node_id;
    nodeToken = credentials.node_token;

    const session = readSessionStorage();
    sessionSrc = session.src || "direct";

    try {
      const requestStarted = performance.now();
      const run = await api("/game/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${nodeToken}` },
        body: JSON.stringify({ node_id: nodeId })
      });
      if (!Number.isFinite(run.remaining_ms) || run.remaining_ms < 0) throw new Error("invalid_run_lifetime");
      playableMs = Math.max(0, Math.floor(run.remaining_ms - (performance.now() - requestStarted) - 5000));
      currentRun = run;
      surfer.lane = surfer.targetLane = 1;
      obstacles = [];
      writeSessionStorage({ runId: run.run_id });
      course = generateCourse(run.seed);
      distanceCm = 0;
      events = [{ timestamp_ms: 0, event_type: "run_started", payload: "{}" }];
      startTime = performance.now();
      lastFrameTime = startTime;
      running = true;
      gameState = "playing";
      gameOverlay.hidden = true;
      gameUI.hidden = false;
      updateHUD();
      expiryTimer = setTimeout(() => endRun("timeout"), playableMs);
      requestAnimationFrame(gameLoop);
    } catch (error) {
      showError(`Failed to start run: ${error.message}`);
    }
  }

  function gameLoop(timestamp) {
    if (!running) return;

    if (timestamp - startTime >= playableMs) { endRun("timeout"); return; }
    const deltaMs = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    update(deltaMs);
    render();

    if (running) {
      animationId = requestAnimationFrame(gameLoop);
    }
  }

  function update(deltaMs) {
    const previousDistanceCm = distanceCm;
    const distanceDelta = speedCmPerMs * deltaMs;
    distanceCm += distanceDelta;

    // Match the discrete lanes recorded by steering events and server replay.
    surfer.lane = surfer.targetLane;
    surfer.x = (canvas.width / dpr) / LANES * (surfer.lane + 0.5) - surfer.width / 2;

    obstacles = course.filter(o => o.distance_cm > distanceCm - 5000 && o.distance_cm < distanceCm + 50000);

    // An obstacle arrives at the rendered surfer center at its course distance.
    // Check the swept distance so a delayed frame cannot skip an arrival.
    // Replay recorded inputs at each arrival, not at the latest rendered lane.
    // The generated course and event history are both chronologically ordered.
    let collisionLane = 1;
    let eventIdx = 1;
    for (const obstacle of course) {
      if (obstacle.distance_cm > previousDistanceCm && obstacle.distance_cm <= distanceCm) {
        const obstacleMs = obstacle.distance_cm / speedCmPerMs;
        while (eventIdx < events.length && events[eventIdx].timestamp_ms <= obstacleMs) {
          const event = events[eventIdx++];
          if (event.event_type === "steer_left") collisionLane = Math.max(0, collisionLane - 1);
          else if (event.event_type === "steer_right") collisionLane = Math.min(2, collisionLane + 1);
          else if (event.event_type === "steer_center") collisionLane = 1;
        }
        if (collisionLane === obstacle.lane) {
          distanceCm = obstacle.distance_cm;
          obstacles = course.filter(o => o.distance_cm > distanceCm - 5000 && o.distance_cm < distanceCm + 50000);
          endRun("collision");
          return;
        }
      }
    }

    if (obstacles.length === 0 && distanceCm > course[course.length - 1]?.distance_cm) {
      endRun("course_complete");
      return;
    }

    updateHUD();
  }

  function render() {
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;

    ctx.clearRect(0, 0, cw, ch);

    drawOcean(cw, ch);
    drawLanes(cw, ch);
    drawObstacles(cw, ch);
    drawSurfer(cw, ch);
    drawParticles(cw, ch);
  }

  function drawOcean(cw, ch) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ch);
    gradient.addColorStop(0, "#0a1628");
    gradient.addColorStop(0.5, "#0d1b2a");
    gradient.addColorStop(1, "#1b263b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = "rgba(78, 205, 196, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const y = (ch / 20) * i + (Date.now() * 0.02) % (ch / 20);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
    }
  }

  function drawLanes(cw, ch) {
    const laneWidth = cw / LANES;
    ctx.strokeStyle = "rgba(78, 205, 196, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([20, 20]);
    ctx.lineDashOffset = -(Date.now() * 0.1) % 40;

    for (let i = 1; i < LANES; i++) {
      const x = laneWidth * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawObstacles(cw, ch) {
    for (const obstacle of obstacles) {
      const screenY = surfer.y - (obstacle.distance_cm - distanceCm) * (surfer.y / 50000);
      if (screenY < -50 || screenY > ch + 50) continue;

      const laneX = (cw / LANES) * (obstacle.lane + 0.5);
      const size = Math.max(20, Math.min(60, 40 * (1 + (surfer.y - screenY) / ch)));

      ctx.fillStyle = OBSTACLE_COLORS[obstacle.type] || "#888";
      ctx.beginPath();

      if (obstacle.type === "buoy") {
        ctx.arc(laneX, screenY, size * 0.5, 0, Math.PI * 2);
      } else if (obstacle.type === "rock") {
        ctx.moveTo(laneX, screenY - size * 0.5);
        ctx.lineTo(laneX + size * 0.5, screenY);
        ctx.lineTo(laneX, screenY + size * 0.5);
        ctx.lineTo(laneX - size * 0.5, screenY);
        ctx.closePath();
      } else {
        ctx.rect(laneX - size * 0.4, screenY - size * 0.3, size * 0.8, size * 0.6);
      }
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawSurfer(cw, ch) {
    const laneCenter = (cw / LANES) * (surfer.lane + 0.5);
    const x = laneCenter - surfer.width / 2;
    const y = surfer.y;

    ctx.save();
    ctx.translate(laneCenter, y);

    const gradient = ctx.createLinearGradient(-surfer.width/2, 0, surfer.width/2, 0);
    gradient.addColorStop(0, "#4ecdc4");
    gradient.addColorStop(0.5, "#06d6a0");
    gradient.addColorStop(1, "#4ecdc4");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -surfer.height * 0.5);
    ctx.lineTo(surfer.width * 0.35, -surfer.height * 0.2);
    ctx.lineTo(surfer.width * 0.4, surfer.height * 0.5);
    ctx.lineTo(-surfer.width * 0.4, surfer.height * 0.5);
    ctx.lineTo(-surfer.width * 0.35, -surfer.height * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, -surfer.height * 0.35, surfer.width * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0a1628";
    ctx.beginPath();
    ctx.arc(0, -surfer.height * 0.35, surfer.width * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  let particles = [];
  function drawParticles(cw, ch) {
    if (Math.random() < 0.1) {
      particles.push({
        x: Math.random() * cw,
        y: ch,
        size: 1 + Math.random() * 3,
        speed: 0.5 + Math.random() * 1.5,
        opacity: 0.1 + Math.random() * 0.2
      });
    }

    ctx.fillStyle = "rgba(78, 205, 196, 0.3)";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.y -= p.speed;
      p.opacity -= 0.002;
      if (p.y < 0 || p.opacity <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateHUD() {
    const miles = distanceCm / 160934.4;
    hudDistance.textContent = miles.toFixed(2) + " mi";
    if (currentRun) {
      hudContest.textContent = currentRun.contest_day;
    }
  }

  function handleSteer(direction) {
    if (!running || gameState !== "playing") return;
    if (performance.now() - startTime >= playableMs) { endRun("timeout"); return; }
    if (events.length >= 499) { endRun("event_limit"); return; }
    if (direction === "left") surfer.targetLane = Math.max(0, surfer.targetLane - 1);
    else if (direction === "right") surfer.targetLane = Math.min(LANES - 1, surfer.targetLane + 1);
    else if (direction === "center") surfer.targetLane = 1;

    const now = performance.now();
    events.push({
      timestamp_ms: Math.round(now - startTime),
      event_type: direction === "left" ? "steer_left" : direction === "right" ? "steer_right" : "steer_center",
      payload: "{}"
    });
  }

  function endRun(reason) {
    if (!running) return;
    clearTimeout(expiryTimer);
    running = false;
    gameState = "ended";
    cancelAnimationFrame(animationId);
    gameUI.hidden = true;

    const durationMs = Math.min(playableMs, Math.round(performance.now() - startTime));
    events.push({
      timestamp_ms: durationMs,
      event_type: "run_ended",
      payload: JSON.stringify({ reason, distance_cm: Math.round(distanceCm) })
    });

    resultDistance.textContent = (distanceCm / 160934.4).toFixed(2) + " miles";
    resultReason.textContent = reason === "collision" ? "CRASH" : reason === "course_complete" ? "COURSE COMPLETE" : "RUN ENDED";
    resultReason.style.color = reason === "collision" ? "#f87171" : "#4ecdc4";
    resultNote.textContent = "Submitting run to server for verification...";
    resultDisplay.hidden = false;
    gameOverlay.hidden = false;

    submitScore();
  }

  async function submitScore() {
    const session = readSessionStorage();
    const nickname = session.nickname || "";
    if (!nickname) {
      resultNote.textContent = "No nickname found. Return to surf.html to set one.";
      return;
    }

    try {
      const result = await api("/game/result", {
        method: "POST",
        headers: { Authorization: `Bearer ${nodeToken}` },
        body: JSON.stringify({
          node_id: nodeId,
          run_id: currentRun.run_id,
          events,
          nickname
        })
      });

      resultDistance.textContent = result.distance_miles + " miles";
      
      if (result.leaderboard) {
        resultNote.textContent = "Score verified and submitted! Redirecting to leaderboard...";
        writeSessionStorage({ 
          verifiedDistance: result.distance_miles,
          runId: currentRun.run_id
        });
        
        setTimeout(() => {
          window.location.href = `/commonwealth/leaderboard/?src=${encodeURIComponent(sessionSrc)}&verified=1&run=${encodeURIComponent(currentRun.run_id)}`;
        }, 1500);
      } else {
        resultNote.textContent = "Score recorded. Add a nickname to appear on leaderboard.";
        nicknameForm.hidden = false;
        nicknameInput.focus();
      }
    } catch (error) {
      resultNote.textContent = "Submission failed: " + error.message;
      nicknameForm.hidden = false;
      nicknameInput.focus();
    }
  }

  function showError(msg) {
    overlayContent.querySelector("h2").textContent = "ERROR";
    overlayContent.querySelector(".subtitle").textContent = "";
    resultDisplay.hidden = true;
    nicknameForm.hidden = true;
    resultNote.textContent = msg;
    gameOverlay.hidden = false;
  }

  function init() {
    window.addEventListener("resize", resize);
    resize();

    document.addEventListener("keydown", e => {
      if (gameState === "playing") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") handleSteer("left");
        else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") handleSteer("right");
        else if (e.key === " " || e.key === "Space") { e.preventDefault(); handleSteer("center"); }
      }
    });

    canvas.addEventListener("touchstart", e => {
      if (gameState !== "playing") return;
      const rect = canvas.getBoundingClientRect();
      const touchX = e.touches[0].clientX - rect.left;
      const third = rect.width / 3;
      if (touchX < third) handleSteer("left");
      else if (touchX > 2 * third) handleSteer("right");
      else handleSteer("center");
    }, { passive: true });

    playAgainBtn.addEventListener("click", () => {
      gameOverlay.hidden = true;
      clearSessionStorage();
      startGameRun();
    });

    viewLeaderboardBtn.addEventListener("click", (e) => {
      const session = readSessionStorage();
      e.preventDefault();
      window.location.href = `/commonwealth/leaderboard/?src=${encodeURIComponent(session.src || "direct")}`;
    });

    // Check if we have a verified run to show immediately
    const session = readSessionStorage();
    if (session.verifiedDistance && session.runId) {
      resultDistance.textContent = session.verifiedDistance + " miles";
      resultReason.textContent = "VERIFIED";
      resultReason.style.color = "#4ecdc4";
      resultNote.textContent = "Previously verified run. Redirecting to leaderboard...";
      resultDisplay.hidden = false;
      gameOverlay.hidden = false;
      setTimeout(() => {
        window.location.href = `/commonwealth/leaderboard/?src=${encodeURIComponent(session.src)}&verified=1&run=${encodeURIComponent(session.runId)}`;
      }, 1500);
      return;
    }

    // Auto-start if ?play=1
    const params = new URLSearchParams(window.location.search);
    if (params.get("play") === "1") {
      startGameRun();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
