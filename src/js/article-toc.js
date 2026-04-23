(function () {
  const body = document.querySelector('.article-body');
  const tocNav = document.querySelector('.toc-nav');
  const progressFill = document.querySelector('.toc-progress-fill');

  if (!body || !tocNav || !progressFill) return;

  // ── Build TOC from h2 / h3 headings ──────────────────

  const headings = Array.from(body.querySelectorAll('h2, h3'));

  headings.forEach(function (heading) {
    // Assign an ID if the heading doesn't have one
    if (!heading.id) {
      heading.id = heading.textContent.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = heading.textContent;
    link.className = 'toc-link' +
      (heading.tagName === 'H3' ? ' toc-link--h3' : '');
    link.dataset.headingId = heading.id;

    tocNav.appendChild(link);
  });

  // ── Progress bar ──────────────────────────────────────
  // Cache measurements once — getBoundingClientRect inside a scroll
  // handler forces layout recalculation on every event.

  var articleTop = body.getBoundingClientRect().top + window.scrollY;
  var articleHeight = body.scrollHeight;

  // Recalculate if the window is resized
  window.addEventListener('resize', function () {
    articleTop = body.getBoundingClientRect().top + window.scrollY;
    articleHeight = body.scrollHeight;
  }, { passive: true });

  function updateProgress() {
    var scrolled = window.scrollY - articleTop;
    var pct = Math.min(Math.max(scrolled / (articleHeight - window.innerHeight) * 100, 0), 100);
    progressFill.style.height = pct + '%';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // ── Active section via IntersectionObserver ───────────

  var links = Array.from(tocNav.querySelectorAll('.toc-link'));
  var activeId = headings.length ? headings[0].id : null;

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    links.forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.headingId === activeId);
    });
  }

  // Highlight the first link on load
  if (activeId) {
    links.forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.headingId === activeId);
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    // Find the topmost heading currently intersecting
    var visible = entries
      .filter(function (e) { return e.isIntersecting; })
      .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });

    if (visible.length) {
      setActive(visible[0].target.id);
    }
  }, {
    rootMargin: '-10% 0px -75% 0px',
    threshold: 0
  });

  headings.forEach(function (h) { observer.observe(h); });

})();
