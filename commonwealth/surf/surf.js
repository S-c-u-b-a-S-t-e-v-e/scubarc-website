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
    const url = new URL(href, window.location.origin);
    url.searchParams.set('src', src);
    return url.toString();
  }

  // Update all Commonwealth links to preserve src
  function updateCommonwealthLinks() {
    document.querySelectorAll('a[href^="../commonwealth"], a[href^="./"], a[href^="/commonwealth"]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('#')) {
        a.setAttribute('href', preserveSrc(href));
      }
    });
    // Also update absolute links to commonwealth routes
    document.querySelectorAll('a[href*="/commonwealth/"]').forEach(a => {
      const href = a.getAttribute('href');
      if (href) {
        a.setAttribute('href', preserveSrc(href));
      }
    });
  }

  // Surf form handling
  const form = document.getElementById('surf-form');
  const statusEl = document.getElementById('surf-status');
  const startBtn = document.getElementById('surf-start');
  const nicknameInput = document.getElementById('surf-nickname');

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

      // Store nickname and src in sessionStorage for game page to pick up
      sessionStorage.setItem('commonwealth_nickname', nickname);
      sessionStorage.setItem('commonwealth_src', src);

      // TODO: Game worker will implement /api/compute/game/start
      // For now, redirect to a placeholder game page or show integration point
      // The game worker should read nickname and src from sessionStorage
      // and call POST /api/compute/game/start with { nickname, src }

      // Placeholder: redirect to a game page that the game worker will create
      // For now, we'll show an integration message
      statusEl.textContent = 'Game integration pending — game worker owns implementation.';

      // When game worker creates the game page, this should redirect to:
      // window.location.href = preserveSrc('../game.html'); // or whatever the game route is
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