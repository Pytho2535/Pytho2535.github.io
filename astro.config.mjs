// @ts-check
import { defineConfig } from 'astro/config';
import { rehypeImageAttrs } from './src/lib/rehype-image-attrs.mjs';

export default defineConfig({
  site: 'https://Pytho2535.github.io',
  base: '/',
  markdown: {
    // Stamps every screenshot in a writeup with its real size and a
    // lazy flag, so the page stops jumping while they load.
    rehypePlugins: [rehypeImageAttrs],
  },
});
