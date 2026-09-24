// @ts-check
import { defineConfig } from 'astro/config';
import { rehypeImageAttrs } from './src/lib/rehype-image-attrs.mjs';

export default defineConfig({
  site: 'https://pytho0.day',
  base: '/',
  markdown: {
    // Stamps every screenshot in a writeup with its real size and a
    // lazy flag, so the page stops jumping while they load.
    rehypePlugins: [rehypeImageAttrs],
  },
});
