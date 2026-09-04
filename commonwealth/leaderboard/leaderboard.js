/**
 * Commonwealth Surf Leaderboard — Frontend adapter
 * Consumes read-only server leaderboard/status APIs
 * Expected API contract (to be implemented by game worker):
 * 
 * GET /api/compute/leaderboard?tab=today|week|all&limit=50
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
 * GET /api/compute/leaderboard/stats (or included in above)
 * Response:
 * { "players_today": 42, "runs_today": 156, "best_distance_miles": 123.45 }
 */

(function () {
  'use strict';

  const API_BASE = '/api/compute';
  const REFRESH_INTERVAL = 3000; // 3 seconds
  const MAX_ENTRIES = 50;

  let currentTab = 'today';
  let refreshTimer = null;
  let abortController = null;

  const tabs = {
    today: document.getElementById('tab-today'),
    week: document.getElementById('tab-week'),
    all: document.getElementById('tab-all')
  };

  const leaderbody = document.getElementById('leaderbody');
  const statPlayers = document.getElementById('stat-players');
  const statRuns = document.getElementById('stat-runs');
  const statBest = document.getElementById('stat-best');

  function setTab(tab) {
    currentTab = tab;
    Object.entries(tabs).forEach(([key, el]) => {
      if (el) {
        el.setAttribute('aria-selected', key === tab);
      }
    });
    fetchLeaderboard();
  }

  function formatDistance(miles) {
    if (typeof miles !== 'number' || !Number.isFinite(miles)) return '—';
    return miles.toFixed(2);
  }

  function formatTime(isoString) {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '—';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  function renderEntry(entry, index) {
    const tr = document.createElement('tr');
    if (entry.exhibition) {
      tr.classList.add('exhibition-row');
    }
    tr.innerHTML = `
      <td class="rank">${entry.rank}</td>
      <td class="nickname">${escapeHtml(entry.nickname)}</td>
      <td class="distance">${formatDistance(entry.distance_miles)} mi</td>
      <td class="achieved">${formatTime(entry.achieved_at)}</td>
      <td class="status-col">
        ${entry.exhibition ? '<span class="exhibition-badge">EXHIBITION</span>' : ''}
      </td>
    `;
    return tr;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderLeaderboard(data) {
    if (!data || !data.entries || data.entries.length === 0) {
      leaderbody.innerHTML = '<tr class="leaderboard-empty"><td colspan="5">No scores yet today. Be the first to surf!</td></tr>';
      return;
    }

    leaderbody.innerHTML = '';
    data.entries.forEach((entry, i) => {
      // Ensure rank is correct
      const rankedEntry = { ...entry, rank: entry.rank || i + 1 };
      leaderbody.appendChild(renderEntry(rankedEntry, i));
    });
    
    // Add exhibition footnote if any exhibition entries present
    const hasExhibition = data.entries.some(e => e.exhibition);
    if (hasExhibition) {
      const footnote = document.createElement('tr');
      footnote.className = 'leaderboard-footnote';
      footnote.innerHTML = '<td colspan="5" style="font-size:.75rem;color:var(--muted);padding-top:.5rem;">EXHIBITION entries are ScubaRC organizer runs — not prize eligible.</td>';
      leaderbody.appendChild(footnote);
    }
  }

  function renderStats(stats) {
    if (!stats) return;
    if (statPlayers) statPlayers.textContent = stats.players_today ?? '—';
    if (statRuns) statRuns.textContent = stats.runs_today ?? '—';
    if (statBest) statBest.textContent = formatDistance(stats.best_distance_miles);
  }

  async function fetchLeaderboard() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      const url = `${API_BASE}/leaderboard?tab=${currentTab}&limit=${MAX_ENTRIES}`;
      const response = await fetch(url, {
        signal: abortController.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      renderLeaderboard(data);
      renderStats(data.stats);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Leaderboard fetch failed:', err);
        leaderbody.innerHTML = '<tr class="leaderboard-empty"><td colspan="5">Unable to load leaderboard. Retrying…</td></tr>';
      }
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(fetchLeaderboard, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Tab click handlers
  Object.entries(tabs).forEach(([tab, el]) => {
    if (el) {
      el.addEventListener('click', () => setTab(tab));
    }
  });

  // Page visibility handling
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      fetchLeaderboard();
      startAutoRefresh();
    }
  });

  // Initial load
  fetchLeaderboard();
  startAutoRefresh();

  // Expose for debugging
  window.CommonwealthLeaderboard = {
    refresh: fetchLeaderboard,
    setTab,
    stopAutoRefresh,
    startAutoRefresh
  };
})();