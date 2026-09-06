/**
 * Commonwealth Surf — Entry integration shell
 * Preserves src query parameter through session flow
 * Does NOT implement game logic — that belongs to the game worker
 */

(function () {
  'use strict';

  // Preserve src parameter for attribution
  const SRC_PARAMS = ['bar', 'direct', 'shared', 'scubarc'];
  function getSrc() {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    return SRC_PARAMS.includes(src) ? src : 'direct';
  }

  function preserveSrc(href) {
    const src = getSrc();
    const url = new URL(href, window.location.href);
    url.searchParams.set('src', src);
    return url.toString();
  }

  // Update all Commonwealth links to preserve src
  function updateCommonwealthLinks() {
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }
      // Check if it's a Commonwealth route
      const isCommonwealthRoute =
        href.includes('/commonwealth/') ||
        href.startsWith('../commonwealth/') ||
        href.startsWith('./commonwealth/') ||
        href === '../commonwealth' ||
        href === './commonwealth' ||
        href === 'surf' ||
        href === 'leaderboard' ||
        href === 'live' ||
        href === 'compute';

      if (isCommonwealthRoute) {
        a.setAttribute('href', preserveSrc(href));
      }
    });
  }

  // Surf form handling
  const form = document.getElementById('surf-form');
  const statusEl = document.getElementById('surf-status');
  const startBtn = document.getElementById('surf-start');
  const nicknameInput = document.getElementById('surf-nickname');
  const config = window.SCUBARC_COMPUTE_CONFIG || {};
  let humanToken = '';
  let widgetId;

  function hasCredential() {
    return localStorage.getItem('scubarc_cc_node_id') && localStorage.getItem('scubarc_cc_node_token');
  }

  async function ensureCredential(nickname) {
    if (hasCredential()) return;
    if (!humanToken) {
      if (!config.turnstileSiteKey) throw new Error('Human verification is unavailable. Please try again later.');
      if (widgetId === undefined) {
        statusEl.textContent = 'Complete human verification to start surfing.';
        await new Promise((resolve, reject) => {
          if (window.turnstile) return resolve();
          const script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Human verification could not load. Please retry.'));
          document.head.appendChild(script);
        });
        widgetId = window.turnstile.render('#surf-human-verification', {
          sitekey: config.turnstileSiteKey,
          callback: token => { humanToken = token; statusEl.textContent = 'Verification complete. Select Start Surfing.'; },
          'expired-callback': () => { humanToken = ''; },
          'error-callback': () => { humanToken = ''; statusEl.textContent = 'Human verification failed. Please retry.'; }
        });
      }
      throw new Error('Complete human verification, then select Start Surfing.');
    }
    const response = await fetch(`${config.apiBase || '/api/compute'}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: nickname,
        consent_version: 'commonwealth-surf-v0',
        turnstile_token: humanToken,
        capabilities: { wasm_support: typeof WebAssembly === 'object', logical_processors: navigator.hardwareConcurrency || 1,
          platform: navigator.platform, user_agent: navigator.userAgent, device_class: 'desktop', webgpu_support: false }
      })
    });
    humanToken = '';
    if (widgetId !== undefined) window.turnstile.reset(widgetId);
    const credential = await response.json();
    if (!response.ok || !credential.node_id || !credential.node_token) throw new Error('Browser verification failed. Please complete human verification again.');
    localStorage.setItem('scubarc_cc_node_id', credential.node_id);
    localStorage.setItem('scubarc_cc_node_token', credential.node_token);
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nickname = nicknameInput.value.trim().slice(0, 24);
      if (!nickname) {
        statusEl.textContent = 'Please enter a nickname.';
        return;
      }

      const consent = form.querySelector('input[name="consent"]').checked;
      if (!consent) {
        statusEl.textContent = 'You must accept the terms to play.';
        return;
      }

      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';
      statusEl.textContent = '';

      const src = getSrc();

      try {
        await ensureCredential(nickname);
      } catch (error) {
        statusEl.textContent = error.message;
        startBtn.disabled = false;
        startBtn.textContent = 'START SURFING';
        return;
      }
      sessionStorage.removeItem('commonwealth_run_id');
      sessionStorage.removeItem('commonwealth_verified_distance');

      // Store nickname and src in sessionStorage for game page to pick up
      // SESSIONSTORAGE CONTRACT (for game worker):
      // - commonwealth_nickname: string (max 24 chars, player's chosen nickname)
      // - commonwealth_src: 'bar' | 'direct' | 'shared' | 'scubarc' (attribution source)
      sessionStorage.setItem('commonwealth_nickname', nickname);
      sessionStorage.setItem('commonwealth_src', src);

      // Redirect to game page (game worker implements game.html)
      // Game worker reads sessionStorage, calls POST /api/compute/game/start with { nickname, src }
      window.location.href = preserveSrc('/commonwealth/surf/game.html');
    });
  }

  // Initialize
  updateCommonwealthLinks();

  // Expose for game worker integration
  window.CommonwealthSurf = {
    getSrc,
    preserveSrc,
    getNickname: () => sessionStorage.getItem('commonwealth_nickname'),
    clearSession: () => {
      sessionStorage.removeItem('commonwealth_nickname');
      sessionStorage.removeItem('commonwealth_src');
    }
  };
})();
