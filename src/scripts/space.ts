/*
  Loads the background scene. three.js is the heaviest thing on the
  site, so it is normally fetched once the page is up and the browser
  is idle; until then the gradient on <html> stands in for it. When the
  home page's intro is due, the scene is the intro, so it is fetched
  straight away instead.

  The canvas is persisted across page swaps (Base.astro), so the scene
  is built once and only told which page it is now behind: the home
  page shows the planet, every other page just the stars.
*/
import { reduceMotion, introPending } from './motion';
import type { SpaceScene, SpaceMode } from './space-scene';

let scene: SpaceScene | undefined;
let mode: SpaceMode = 'page';
let loading = false;
let intro = false;

const currentMode = (): SpaceMode => (document.querySelector('[data-planet]') ? 'home' : 'page');
/* Sent a tick late, so the home page's script, which handles the same
   page-load after this one, is already listening. */
const introDone = () => setTimeout(() => document.dispatchEvent(new Event('pytho:intro-done')));

function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

document.addEventListener('astro:page-load', () => {
  mode = currentMode();
  intro = mode === 'home' && introPending();
  if (scene) { scene.setMode(mode, intro); return; }
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-space]');
  if (!canvas || !hasWebGL()) { if (intro) introDone(); return; }
  if (loading) return;
  loading = true;
  const start = () => {
    import('./space-scene')
      .then(({ createSpace }) => {
        scene = createSpace(canvas, mode, intro, reduceMotion);
        canvas.classList.add('is-ready');
      })
      .catch(() => { canvas.remove(); if (intro) introDone(); });
  };
  if (intro) start();
  else if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 700 });
  else setTimeout(start, 200);
});

/* Skipping before the scene has even arrived just ends the intro; the
   planet then turns up already in place. */
/* Opening a writeup from the home page flies in towards the planet. */
document.addEventListener('pytho:fly', () => scene?.flyIn());

document.addEventListener('pytho:intro-skip', () => {
  if (scene) scene.skipIntro();
  else { intro = false; introDone(); }
});
