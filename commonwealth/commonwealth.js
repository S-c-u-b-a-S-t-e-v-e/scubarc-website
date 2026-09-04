/**
 * Commonwealth.ai — Main landing page integration
 * Preserves src query parameter through all Commonwealth links
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
    const url = new URL(href, window.location.origin);
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

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateCommonwealthLinks);
  } else {
    updateCommonwealthLinks();
  }

  // Also update on navigation (for SPA-like behavior if needed)
  window.addEventListener('popstate', updateCommonwealthLinks);

  // Expose for debugging
  window.Commonwealth = {
    getSrc,
    preserveSrc
  };
})();