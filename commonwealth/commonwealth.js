/**
 * Commonwealth.ai — Main landing page integration
 * Preserves src query parameter through all Commonwealth links
 * Mobile navigation toggle
 */

(function () {
  'use strict';

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

  function updateCommonwealthLinks() {
    // Update all links that point to Commonwealth routes
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      
      // Skip external links, anchors, and non-Commonwealth routes
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

  // Mobile navigation toggle
  function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('primary-nav');
    const overlay = document.querySelector('.nav-overlay');
    
    if (!toggle || !nav || !overlay) return;
    
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
    document.addEventListener('DOMContentLoaded', () => {
      updateCommonwealthLinks();
      initMobileNav();
    });
  } else {
    updateCommonwealthLinks();
    initMobileNav();
  }

  // Also update on navigation (for SPA-like behavior if needed)
  window.addEventListener('popstate', updateCommonwealthLinks);

  // Expose for debugging
  window.Commonwealth = {
    getSrc,
    preserveSrc
  };
})();