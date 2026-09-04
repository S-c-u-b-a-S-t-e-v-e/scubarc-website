/**
 * Commonwealth Surf Live — TV/Bar spectator display
 * Consumes read-only server leaderboard/status APIs
 * Expected API contract (to be implemented by game worker):
 * 
 * GET /api/compute/leaderboard?tab=today&limit=5
 * Response:
 * {
 *   "entries": [
 *     {
 *       "rank": 1,
 *       "nickname": "string",
 *       "distance_miles": 123.45,
 *       "achieved_at": "ISO8601 timestamp",
 *       "exhibition": false
 *     }
 *   ],
 *   "stats": {
 *     "players_today": 42,
 *     "runs_today": 156,
 *     "best_distance_miles": 123.45
 *   }
 * }
 * 
 * Optional: GET /api/compute/live/current
 * Response (if current player available):
 * {
 *   "nickname": "string",
 *   "distance_miles": 67.89,
 *   "updated_at": "ISO8601 timestamp"
 * }
 * 
 * GET /api/compute/leaderboard/stats
 * Response:
 * { "players_today": 42, "runs_today": 156, "best_distance_miles": 123.45 }
 */

(function () {
  'use strict';

  const API_BASE = '/api/compute';
  const REFRESH_INTERVAL = 3000; // 3 seconds
  const LEADERBOARD_LIMIT = 5;

  let refreshTimer = null;
  let abortController = null;

  const currentNickname = document.getElementById('current-nickname');
  const currentDistance = document.getElementById('current-distance');
  const liveLeaderboard = document.getElementById('live-leaderboard');
  const qrImage = document.getElementById('qr-image');
  const todayPlayers = document.getElementById('today-players');
  const todayRuns = document.getElementById('today-runs');
  const todayBest = document.getElementById('today-best');

  function formatDistance(miles) {
    if (typeof miles !== 'number' || !Number.isFinite(miles)) return '—';
    return miles.toFixed(2);
  }

  function formatDistanceShort(miles) {
    if (typeof miles !== 'number' || !Number.isFinite(miles)) return '—';
    return miles.toFixed(2) + ' mi';
  }

  function renderLeaderboard(entries) {
    if (!entries || entries.length === 0) {
      liveLeaderboard.innerHTML = `
        <div class="live-leaderboard-item">
          <span class="rank">1</span>
          <span class="nickname">—</span>
          <span class="distance">— mi</span>
        </div>
        <div class="live-leaderboard-item">
          <span class="rank">2</span>
          <span class="nickname">—</span>
          <span class="distance">— mi</span>
        </div>
        <div class="live-leaderboard-item">
          <span class="rank">3</span>
          <span class="nickname">—</span>
          <span class="distance">— mi</span>
        </div>
        <div class="live-leaderboard-item">
          <span class="rank">4</span>
          <span class="nickname">—</span>
          <span class="distance">— mi</span>
        </div>
        <div class="live-leaderboard-item">
          <span class="rank">5</span>
          <span class="nickname">—</span>
          <span class="distance">— mi</span>
        </div>
      `;
      return;
    }

    liveLeaderboard.innerHTML = '';
    entries.slice(0, LEADERBOARD_LIMIT).forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'live-leaderboard-item' + (entry.exhibition ? ' exhibition-row' : '');
      div.innerHTML = `
        <span class="rank">${entry.rank || i + 1}</span>
        <span class="nickname">${escapeHtml(entry.nickname)}${entry.exhibition ? ' <span class="exhibition" style="font-size:.6rem;">EXH</span>' : ''}</span>
        <span class="distance">${formatDistanceShort(entry.distance_miles)}</span>
      `;
      liveLeaderboard.appendChild(div);
    });
  }

  function renderCurrentPlayer(data) {
    if (data && data.nickname) {
      currentNickname.textContent = escapeHtml(data.nickname);
      currentNickname.classList.remove('waiting');
      if (typeof data.distance_miles === 'number' && Number.isFinite(data.distance_miles)) {
        currentDistance.textContent = formatDistanceShort(data.distance_miles);
        currentDistance.style.display = 'block';
      } else {
        currentDistance.style.display = 'none';
      }
    } else {
      currentNickname.textContent = 'Waiting for player…';
      currentNickname.classList.add('waiting');
      currentDistance.style.display = 'none';
    }
  }

  function renderStats(stats) {
    if (!stats) return;
    if (todayPlayers) todayPlayers.textContent = stats.players_today ?? '—';
    if (todayRuns) todayRuns.textContent = stats.runs_today ?? '—';
    if (todayBest) todayBest.textContent = formatDistance(stats.best_distance_miles);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function generateQRCode(url) {
    // Use a simple QR code service - in production, this should be a local generator
    // For now, using a reliable free QR code API
    const encodedUrl = encodeURIComponent(url);
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodedUrl}&margin=10&color=050b11&bgcolor=f4f7fb`;
  }

  async function fetchLiveData() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      // Fetch leaderboard and stats
      const leaderboardUrl = `${API_BASE}/leaderboard?tab=today&limit=${LEADERBOARD_LIMIT}`;
      const [leaderboardRes, statsRes] = await Promise.all([
        fetch(leaderboardUrl, { signal: abortController.signal, headers: { 'Accept': 'application/json' } }),
        fetch(`${API_BASE}/leaderboard/stats`, { signal: abortController.signal, headers: { 'Accept': 'application/json' } })
      ]);

      if (leaderboardRes.ok) {
        const leaderboardData = await leaderboardRes.json();
        renderLeaderboard(leaderboardData.entries);
        if (leaderboardData.stats) renderStats(leaderboardData.stats);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        renderStats(statsData);
      }

      // Try to fetch current player (optional endpoint)
      try {
        const currentRes = await fetch(`${API_BASE}/live/current`, { 
          signal: abortController.signal, 
          headers: { 'Accept': 'application/json' } 
        });
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          renderCurrentPlayer(currentData);
        }
      } catch {
        // Optional endpoint - ignore if not available
      }

      // Set QR code to the surf entry page with src=bar
      const surfUrl = `${window.location.origin}/commonwealth/surf?src=bar`;
      if (qrImage) {
        qrImage.src = generateQRCode(surfUrl);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Live data fetch failed:', err);
      }
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(fetchLiveData, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Page visibility handling
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      fetchLiveData();
      startAutoRefresh();
    }
  });

  // Initial load
  fetchLiveData();
  startAutoRefresh();

  // Expose for debugging
  window.CommonwealthLive = {
    refresh: fetchLiveData,
    stopAutoRefresh,
    startAutoRefresh
  };
})();