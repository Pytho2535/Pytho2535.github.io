/*
  The cursor: a green dot on the pointer and a ring that trails it.
  The ring opens over anything that can be clicked, and fills with a
  word where one is set (data-cursor="read" on a writeup row). Over
  the text of a writeup and over code the system cursor comes back,
  because text there is meant to be selected.

  Buttons marked data-magnetic lean towards the pointer.

  A mouse only: on touch there is no pointer to follow.
*/
import { gsap, reduceMotion, finePointer } from './motion';

const root = document.documentElement;

function setupCursor() {
  const dot = document.querySelector<HTMLElement>('[data-cursor-dot]');
  const ring = document.querySelector<HTMLElement>('[data-cursor-ring]');
  const label = ring?.querySelector<HTMLElement>('.cursor-label');
  if (!dot || !ring || !label) return;

  root.classList.add('has-cursor', 'cursor-away');
  const dotX = gsap.quickTo(dot, 'x', { duration: 0.08, ease: 'power3' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.08, ease: 'power3' });
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    root.classList.remove('cursor-away');
    dotX(event.clientX); dotY(event.clientY);
    ringX(event.clientX); ringY(event.clientY);
  }, { passive: true });
  root.addEventListener('mouseleave', () => root.classList.add('cursor-away'));
  document.addEventListener('pointerdown', () => gsap.fromTo(ring, { scale: 0.8 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' }));

  // One listener for the whole document, so it keeps working on every
  // page the router swaps in without being set up again.
  document.addEventListener('pointerover', (event) => {
    const target = event.target as Element;
    const text = target.closest('.prose, pre, .keyblock');
    const word = target.closest<HTMLElement>('[data-cursor]');
    const link = target.closest('a, button, summary, [data-tilt]');
    root.classList.toggle('cursor-text', Boolean(text) && !link);
    ring.classList.toggle('is-label', Boolean(word));
    ring.classList.toggle('is-link', Boolean(link) && !word);
    if (word) label.textContent = word.dataset.cursor ?? '';
  });
}

/* Elements marked data-magnetic follow the pointer a little way while
   it is over them, and spring back when it leaves. */
function setupMagnets(signal: AbortSignal) {
  document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
    const y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
    const pull = Number(el.dataset.magnetic) || 0.35;
    el.addEventListener('pointermove', (event) => {
      const box = el.getBoundingClientRect();
      x((event.clientX - box.left - box.width / 2) * pull);
      y((event.clientY - box.top - box.height / 2) * pull);
    }, { signal });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: true });
    }, { signal });
  });
}

if (finePointer && !reduceMotion) {
  setupCursor();
  document.addEventListener('astro:page-load', () => {
    const page = new AbortController();
    document.addEventListener('astro:before-swap', () => page.abort(), { once: true });
    setupMagnets(page.signal);
  });
  // The router copies the new page's attributes onto <html>, which
  // drops the classes set above; put them back.
  document.addEventListener('astro:after-swap', () => root.classList.add('has-cursor'));
}
