import './article-toc.js'

// Footer year
const yearEl = document.querySelector('.footer-year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle')
const navLinks = document.querySelector('.nav-links')

if (toggle && navLinks) {
  toggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open')
    toggle.classList.toggle('open', isOpen)
    toggle.setAttribute('aria-expanded', isOpen)
  })
}

// Back to top
const backToTop = document.querySelector('.back-to-top')
if (backToTop) {
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400)
  }, { passive: true })
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

// Mark active nav link based on current page
const currentPage = window.location.pathname.split('/').pop() || 'index.html'
document.querySelectorAll('.nav-links a').forEach(link => {
  const href = link.getAttribute('href').split('/').pop()
  if (href === currentPage) link.classList.add('active')
})

// Arrangement filter (arrangements.html only)
const filterBtns = document.querySelectorAll('.filter-btn')
const arrangementCards = document.querySelectorAll('.arrangement-card')

if (filterBtns.length && arrangementCards.length) {
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const filter = btn.dataset.filter
      arrangementCards.forEach(card => {
        const show = filter === 'all' || card.dataset.category === filter
        card.style.display = show ? '' : 'none'
      })
    })
  })
}

// Newsletter modal
const nlModal = document.getElementById('nlModal')
const nlClose = document.getElementById('nlModalClose')
const nlBackdrop = document.getElementById('nlModalBackdrop')

function openNewsletterModal() {
  if (!nlModal) return
  nlModal.classList.add('open')
  nlModal.setAttribute('aria-hidden', 'false')
  document.body.style.overflow = 'hidden'
}

function closeNewsletterModal() {
  if (!nlModal) return
  nlModal.classList.remove('open')
  nlModal.setAttribute('aria-hidden', 'true')
  document.body.style.overflow = ''
}

nlClose?.addEventListener('click', closeNewsletterModal)
nlBackdrop?.addEventListener('click', closeNewsletterModal)
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNewsletterModal() })

// Inline signup forms — prefill modal and open it
document.querySelectorAll('.inline-signup__form').forEach(form => {
  form.addEventListener('submit', e => {
    e.preventDefault()
    const emailVal = form.querySelector('input[type="email"]').value
    const modalEmail = nlModal?.querySelector('input[type="email"]')
    if (modalEmail) modalEmail.value = emailVal
    openNewsletterModal()
  })
})

// PistonLink notify button
const plNotifyBtn = document.getElementById('plNotifyBtn')
if (plNotifyBtn) {
  plNotifyBtn.addEventListener('click', () => {
    if (localStorage.getItem('na_subscribed')) {
      plNotifyBtn.style.display = 'none'
      document.getElementById('plAlreadySubscribed').style.display = 'block'
    } else {
      openNewsletterModal()
    }
  })
}

// Newsletter / consent banner
const BANNER_KEY = 'na_newsletter_dismissed'
const banner = document.getElementById('consentBanner')
const acceptBtn = document.getElementById('consentAccept')
const dismissBtn = document.getElementById('consentDismiss')

if (banner && !localStorage.getItem(BANNER_KEY)) {
  // Show after a short delay so it doesn't pop immediately on load
  setTimeout(() => banner.classList.add('visible'), 2000)

  acceptBtn?.addEventListener('click', () => {
    localStorage.setItem(BANNER_KEY, '1')
    banner.classList.remove('visible')
    openNewsletterModal()
  })

  dismissBtn?.addEventListener('click', () => {
    localStorage.setItem(BANNER_KEY, '1')
    banner.classList.remove('visible')
  })
}
