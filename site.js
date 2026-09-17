/**
 * ScubaRC — Generic site behavior (mobile navigation and shared labels)
 * Loaded by standard ScubaRC root pages.
 */
(function () {
  'use strict';

  function normalizeSharedLabels() {
    document.querySelectorAll('a[href="/commonwealth/"]').forEach((link) => {
      if (link.textContent.trim() === 'Commonwealth.ai') {
        link.textContent = 'ScubaRC Genesis';
      }
    });
  }

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
      document.body.classList.remove('nav-open');
    }

    function openNav() {
      nav.classList.add('open');
      overlay.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('nav-open');
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

    nav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeNav);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        closeNav();
      }
    });
  }

  function init() {
    normalizeSharedLabels();
    initMobileNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();