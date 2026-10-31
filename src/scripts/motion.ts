/*
  Motion shared by every page: smooth scrolling, the scroll line, the
  bar following the sections, headings that rise out of a mask, and
  blocks that arrive as they come into view.

  Lenis owns the scroll and GSAP's ticker drives it, so ScrollTrigger
  and the scroll position never disagree by a frame. Anyone who has
  asked for less motion keeps the browser's own scroll and sees every
  block where it sits.
*/
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, ScrollTrigger, SplitText };

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = matchMedia('(pointer: fine)').matches;

/* The home page opens with the planet assembling, once per visit.
   Not for anyone who asked for less motion, and not when the address
   already points further down the page. */
const INTRO_KEY = 'pytho-intro-seen';
export function introPending() {
  if (reduceMotion || location.hash) return false;
  try { return sessionStorage.getItem(INTRO_KEY) !== '1'; } catch { return false; }
}
export function markIntroSeen() {
  try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* storage unavailable */ }
}

/* Where a section settles under the floating bar. */
const ANCHOR_OFFSET = -24;

let lenis: Lenis | undefined;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

export const getLenis = () => lenis;

export function scrollToTarget(target: HTMLElement | number) {
  if (lenis) {
    // A link in the phone menu is followed while the menu still holds
    // the page still; going somewhere ends that hold.
    lenis.start();
    lenis.scrollTo(target, { offset: typeof target === 'number' ? 0 : ANCHOR_OFFSET, duration: 1.4 });
  } else if (typeof target === 'number') {
    window.scrollTo(0, target);
  } else {
    target.scrollIntoView();
  }
}

/* A link to a section of the page it is on glides there instead of
   jumping. Captured before the router sees it, which then leaves the
   click alone because it has been handled. */
document.addEventListener('click', (event) => {
  if (!lenis || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href*="#"]');
  if (!link || link.target) return;
  const to = new URL(link.href);
  if (to.origin !== location.origin || to.pathname !== location.pathname || !to.hash) return;
  const id = decodeURIComponent(to.hash.slice(1));
  const target = id === 'top' ? 0 : document.getElementById(id);
  if (target === null) return;
  event.preventDefault();
  scrollToTarget(target);
  history.pushState(history.state, '', to.hash);
}, { capture: true });

let context: gsap.Context | undefined;

function scrollLine() {
  const line = document.querySelector<HTMLElement>('[data-progress]');
  if (!line) return;
  gsap.to(line, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: true },
  });
}

/* The bar hides on the way down and returns on the way up; on the
   home page its pill slides under whichever section is being read. */
function barFollow() {
  const bar = document.querySelector<HTMLElement>('[data-bar]');
  if (!bar) return;
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate(self) {
      if (bar.classList.contains('menu-open')) return;
      bar.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 260);
    },
  });

  const indicator = bar.querySelector<HTMLElement>('[data-bar-indicator]');
  const links = [...bar.querySelectorAll<HTMLAnchorElement>('.bar-link[data-target]')];
  const place = (link: HTMLAnchorElement | undefined) => {
    links.forEach((l) => l.classList.toggle('is-active', l === link));
    if (!indicator) return;
    indicator.classList.toggle('is-on', Boolean(link));
    if (link) {
      indicator.style.width = `${link.offsetWidth}px`;
      indicator.style.transform = `translateX(${link.offsetLeft}px)`;
    }
  };
  for (const link of links) {
    const section = document.getElementById(link.dataset.target ?? '');
    if (!section || !section.hasAttribute('data-spy')) continue;
    ScrollTrigger.create({
      trigger: section,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle(self) {
        if (self.isActive) place(link);
        else if (links.every((l) => l === link || !l.classList.contains('is-active'))) place(undefined);
      },
    });
  }
}

/* Headings marked data-split come up line by line from under a mask. */
function splitHeadings() {
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((heading) => {
    SplitText.create(heading, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.15,
          ease: 'expo.out',
          stagger: 0.1,
          scrollTrigger: { trigger: heading, start: 'top 88%', once: true },
        });
      },
    });
  });
}

/* Blocks marked .reveal arrive from below as they come into view, a
   few at a time when several enter together. */
function reveals() {
  const items = gsap.utils.toArray<HTMLElement>('.reveal');
  if (!items.length) return;
  gsap.set(items, { autoAlpha: 0, y: 56 });
  ScrollTrigger.batch(items, {
    start: 'top 92%',
    once: true,
    onEnter: (batch) => gsap.to(batch, {
      autoAlpha: 1,
      y: 0,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.09,
      overwrite: true,
    }),
  });
}

/* A title can be carried from one page to the next: the leaving page
   notes where it was on screen, and the arriving page's title marked
   data-carry starts there and moves into its own place. */
let carried: { box: DOMRect; color: string } | undefined;
export function carryTitle(from: Element) {
  carried = { box: from.getBoundingClientRect(), color: getComputedStyle(from).color };
}
function carry() {
  const title = document.querySelector<HTMLElement>('[data-carry]');
  const from = carried;
  carried = undefined;
  if (!title || !from) return;
  const to = title.getBoundingClientRect();
  // Scaled by height, so the letters line up whatever the two sizes;
  // the new title is wider by its full stop, which arrives with it.
  // It keeps the colour it had in the list and turns as it moves.
  const scale = from.box.height / to.height;
  gsap.from(title, {
    x: from.box.left - to.left,
    y: from.box.top - to.top,
    scale,
    color: from.color,
    transformOrigin: 'left top',
    duration: 1.2,
    ease: 'expo.inOut',
  });
}

/* After a page change (not the first load), what a page marks with
   data-arrive rises into place, one after another. It is held hidden
   from the moment of the swap, so it never shows before it rises. */
let navigated = false;
document.addEventListener('astro:after-swap', () => {
  navigated = true;
  if (reduceMotion) return;
  document.documentElement.classList.add('is-arriving');
  // The carried title is put where the old one was at the very moment
  // of the swap, before the new page's scripts have even run.
  carry();
});
function arrive() {
  const root = document.documentElement;
  if (!navigated) return;
  const items = gsap.utils.toArray<HTMLElement>('[data-arrive]');
  if (items.length) {
    gsap.fromTo(items, { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.09, delay: 0.35 });
    gsap.fromTo('.bar', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, ease: 'power2.out', delay: 0.5, clearProps: 'opacity,visibility' });
  }
  root.classList.remove('is-arriving');
}

document.addEventListener('astro:page-load', () => {
  lenis?.resize();
  context = gsap.context(() => {
    scrollLine();
    barFollow();
    if (reduceMotion) return;
    splitHeadings();
    reveals();
    arrive();
  });
  // Web fonts change line lengths; measure again once they are in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
});

document.addEventListener('astro:before-swap', () => {
  context?.revert();
  context = undefined;
});

/* A new page starts at its own top, not where the last one was left. */
document.addEventListener('astro:after-swap', () => {
  lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
});
