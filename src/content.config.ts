import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Writeups / blog posts live as Markdown files in src/content/writeups/.
// To publish a new post, drop a new .md file in that folder with the
// frontmatter fields below, then commit + push. GitHub Actions builds and
// deploys it automatically.
const writeups = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/writeups' }),
  schema: z.object({
    title: z.string(),
    // Short one-line description shown in the blog list.
    excerpt: z.string(),
    // Publication date (YYYY-MM-DD).
    date: z.coerce.date(),
    // A short tag/category label, e.g. "writeup", "notes", "ctf".
    tag: z.string().default('writeup'),
    // Set to true to keep a post out of the published list (still buildable).
    draft: z.boolean().default(false),
  }),
});

export const collections = { writeups };
