/*
  The home page: the intro, the hero arriving, the preview that follows
  the pointer along the writeups, and the cards that tilt under it.
*/
import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';
import { gsap, SplitText, ScrollTrigger, getLenis, reduceMotion, finePointer, introPending, markIntroSeen, carryTitle } from './motion';

/*
  The intro itself is drawn by the background scene (space-scene.ts):
  the planet's dots gather into a sphere, which sinks to the horizon.
  This side only holds the page still meanwhile (a click or Escape cuts
  it short) and brings the hero in once the scene says the planet is on
  its way down.
  If the scene never says so, the page does not wait for it forever.
*/
function playIntro(signal: AbortSignal, done: () => void) {
  if (!introPending()) { done(); return; }

  document.body.classList.add('intro-active');
  getLenis()?.stop();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(fallback);
    markIntroSeen();
    document.body.classList.remove('intro-active');
    getLenis()?.start();
    done();
  };
  const fallback = window.setTimeout(finish, 4000);
  const skipIt = () => { if (!finished) document.dispatchEvent(new Event('pytho:intro-skip')); };

  document.addEventListener('pytho:intro-done', finish, { signal });
  window.addEventListener('pointerdown', skipIt, { signal });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') skipIt(); }, { signal });
  signal.addEventListener('abort', () => {
    window.clearTimeout(fallback);
    document.body.classList.remove('intro-active');
    getLenis()?.start();
  }, { once: true });
}

function heroIn() {
  const title = document.querySelector<HTMLElement>('[data-hero-title]');
  if (!title || reduceMotion) return;
  const split = SplitText.create(title, { type: 'chars', mask: 'chars', charsClass: 'hero-char' });
  gsap.set('[data-hero-in]', { visibility: 'visible' });
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from(split.chars, { yPercent: 115, duration: 1.4, stagger: 0.07 }, 0)
    .from('[data-hero-fade]', { autoAlpha: 0, y: 30, duration: 1.2, stagger: 0.12 }, 0.35);

  // Scrolling out of the hero lifts and fades it as the planet rises.
  gsap.to('.hero-inner', {
    yPercent: -18,
    autoAlpha: 0,
    scale: 0.96,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 15%', scrub: true },
  });
}

/* The figures in About count up from zero as they come into view. */
function counters() {
  document.querySelectorAll<HTMLElement>('.stat-value').forEach((el) => {
    const target = Number(el.textContent);
    if (!target) return;
    const shown = { value: 0 };
    const write = () => { el.textContent = String(Math.round(shown.value)).padStart(2, '0'); };
    write();
    // The trigger only starts the count; the count is not tied to it,
    // so a refresh or a fast scroll past cannot cut it to its last frame.
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () => gsap.to(shown, { value: target, duration: 1.8, ease: 'power3.out', onUpdate: write }),
    });
  });
}

/* A writeup's head and text, fetched from its own page the first time
   it is pointed at and kept for the next. */
const writeups = new Map<string, Promise<HTMLElement | null>>();
function writeupCopy(href: string) {
  let copy = writeups.get(href);
  if (!copy) {
    copy = fetch(href)
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (!html) return null;
        const page = new DOMParser().parseFromString(html, 'text/html');
        const head = page.querySelector('.post-head');
        const prose = page.querySelector('.prose');
        if (!head || !prose) return null;
        const holder = document.createElement('div');
        holder.append(document.importNode(head, true), document.importNode(prose, true));
        // Its ids and motion hooks belong to the writeup's own page.
        holder.querySelectorAll('[id], [data-carry], [data-arrive]').forEach((el) => {
          el.removeAttribute('id');
          el.removeAttribute('data-carry');
          el.removeAttribute('data-arrive');
        });
        return holder;
      })
      .catch(() => null);
    writeups.set(href, copy);
  }
  return copy;
}

/* A shrunken copy of the writeup trails the pointer along the list and
   reads itself from the top down, then starts over. */
function previews(signal: AbortSignal) {
  const box = document.querySelector<HTMLElement>('[data-preview]');
  const page = box?.querySelector<HTMLElement>('[data-preview-page]');
  if (!box || !page) return;
  const x = gsap.quickTo(box, 'x', { duration: 0.7, ease: 'power3' });
  const y = gsap.quickTo(box, 'y', { duration: 0.7, ease: 'power3' });
  const rotate = gsap.quickTo(box, 'rotation', { duration: 0.9, ease: 'power3' });
  let lastX = 0;
  let shown = '';
  let reading: gsap.core.Timeline | undefined;
  const show = (on: boolean) => gsap.to(box, { autoAlpha: on ? 1 : 0, scale: on ? 1 : 0.85, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });

  const read = async (href: string) => {
    if (href === shown) { reading?.play(); return; }
    shown = href;
    reading?.kill();
    page.replaceChildren();
    const copy = await writeupCopy(href);
    if (href !== shown || !copy) return;
    page.replaceChildren(...copy.cloneNode(true).childNodes);
    const scale = box.clientWidth / page.offsetWidth;
    gsap.set(page, { scale, y: 0, autoAlpha: 1 });
    const distance = page.offsetHeight * scale - box.clientHeight;
    if (distance <= 0) return;
    // An even pace, whatever the length: a long writeup takes longer.
    reading = gsap.timeline({ repeat: -1 })
      .to(page, { y: -distance, duration: distance / 170, ease: 'none' }, 0.9)
      .to(page, { autoAlpha: 0, duration: 0.4 }, '+=1.2')
      .set(page, { y: 0 })
      .to(page, { autoAlpha: 1, duration: 0.4 });
  };

  document.querySelectorAll<HTMLAnchorElement>('.work-item').forEach((row) => {
    row.addEventListener('pointerenter', () => { read(row.href); show(true); }, { signal });
    row.addEventListener('pointerleave', () => { reading?.pause(); show(false); }, { signal });
  });
  signal.addEventListener('abort', () => reading?.kill(), { once: true });
  // The card rides beside the pointer, clear of the cursor's READ ring,
  // and crosses to the other side where it would run off the window.
  const gap = 64;
  window.addEventListener('pointermove', (event) => {
    const right = event.clientX + gap + box.offsetWidth < window.innerWidth - 16;
    x(right ? event.clientX + gap : event.clientX - gap - box.offsetWidth);
    y(event.clientY);
    rotate(gsap.utils.clamp(-8, 8, (event.clientX - lastX) * 0.6));
    lastX = event.clientX;
  }, { passive: true, signal });
}

/* Cards marked data-tilt turn towards the pointer and catch a light
   where it is. */
function tilt(signal: AbortSignal) {
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((card) => {
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
    gsap.set(card, { transformPerspective: 900 });
    card.addEventListener('pointermove', (event) => {
      const box = card.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width;
      const py = (event.clientY - box.top) / box.height;
      ry((px - 0.5) * 14);
      rx((0.5 - py) * 12);
      card.style.setProperty('--mx', `${px * 100}%`);
      card.style.setProperty('--my', `${py * 100}%`);
    }, { signal });
    card.addEventListener('pointerleave', () => { rx(0); ry(0); }, { signal });
  });
}

/* The older writeups unfold under the newest five, and fold away
   again without moving the button out from under the pointer. */
function moreWriteups(signal: AbortSignal) {
  const list = document.querySelector<HTMLElement>('[data-work-list]');
  const button = document.querySelector<HTMLButtonElement>('[data-work-toggle]');
  const label = button?.querySelector<HTMLElement>('[data-work-label]');
  if (!list || !button || !label) return;
  const closed = label.textContent;
  button.addEventListener('click', () => {
    const open = !list.classList.contains('is-open');
    const before = button.getBoundingClientRect().top;
    list.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    label.textContent = open ? 'Show fewer' : closed;
    if (open && !reduceMotion) {
      gsap.from(list.querySelectorAll('.work-extra'), { autoAlpha: 0, y: 40, duration: 0.9, ease: 'expo.out', stagger: 0.06 });
    }
    if (!open) {
      const shift = button.getBoundingClientRect().top - before;
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(window.scrollY + shift, { immediate: true, force: true });
      else window.scrollBy(0, shift);
    }
    getLenis()?.resize();
    ScrollTrigger.refresh();
  }, { signal });
}

/* Opening a writeup: the camera flies in towards the planet while the
   page falls away around the title that was clicked, which then grows
   into the writeup's own title. The next page loads meanwhile, but is
   only put up once the flight is nearly over, so it is never cut off
   halfway. */
function flyToWriteup(signal: AbortSignal) {
  document.addEventListener('astro:before-preparation', (event) => {
    const navigation = event as TransitionBeforePreparationEvent;
    const row = navigation.sourceElement?.closest<HTMLElement>('.work-item');
    if (!row || !navigation.to.pathname.includes('/blog/')) return;
    const load = navigation.loader;
    navigation.loader = async () => {
      document.dispatchEvent(new Event('pytho:fly'));
      const rest = [
        ...document.querySelectorAll('main > :not(#writeups)'),
        ...document.querySelectorAll('#writeups > :not(.work-list)'),
        ...document.querySelectorAll('.work-item'),
      ].filter((el) => el !== row);
      const leaving = gsap.timeline()
        .to(rest, { autoAlpha: 0, y: -40, duration: 0.8, ease: 'power2.inOut' }, 0)
        .to(row.querySelectorAll(':scope > :not(.work-main), .work-excerpt'), { autoAlpha: 0, duration: 0.4 }, 0);
      const flight = new Promise((done) => setTimeout(done, 1050));
      await Promise.all([load(), leaving.then(), flight]);
      const title = row.querySelector('.work-title');
      if (title) carryTitle(title);
    };
  }, { signal });
}

function copyButtons(signal: AbortSignal) {
  document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((button) => {
    const label = button.textContent;
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy ?? ''); button.textContent = 'copied'; }
      catch { button.textContent = 'select text'; }
      window.setTimeout(() => { button.textContent = label; }, 1800);
    }, { signal });
  });
}

document.addEventListener('astro:page-load', () => {
  if (!document.querySelector('[data-planet]')) return;
  const page = new AbortController();
  const { signal } = page;
  const context = gsap.context(() => {});
  document.addEventListener('astro:before-swap', () => { page.abort(); context.revert(); }, { once: true });

  copyButtons(signal);
  moreWriteups(signal);
  playIntro(signal, () => context.add(() => {
    heroIn();
    if (reduceMotion) return;
    counters();
    flyToWriteup(signal);
    if (finePointer) { previews(signal); tilt(signal); }
  }));
});
