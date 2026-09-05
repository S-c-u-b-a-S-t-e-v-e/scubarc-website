/**
 * ScubaRC — Generic site behavior (mobile navigation)
 * Loaded by standard ScubaRC root pages.
 * Does NOT contain Commonwealth-specific logic (src preservation, etc.).
 */
(function () {
  'use strict';

  // Mobile navigation toggle
  function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('primary-nav');
    const overlay = document.querySelector('.nav-overlay');

    if (!toggle || !nav || !overlay) return;

    // Mark as initialized so commonwealth.js doesn't double-init
    if (window.__scubarcMobileNavInitialized) return;
    window.__scubarcMobileNavInitialized = true;

    function closeNav() {
      nav.classList.remove('open');
      overlay.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function openNav() {
      nav.classList.add('open');
      overlay.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function toggleNav() {
      if (nav.classList.contains('open')) {
        closeNav();
      } else {
        openNav();
      }
    }

    toggle.addEventListener('click', toggleNav);
    overlay.addEventListener('click', closeNav);

    // Close nav when clicking a link
    nav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeNav);
    });

    // Close nav on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        closeNav();
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNav);
  } else {
    initMobileNav();
  }
})();