import type { APIRoute } from 'astro';
import { pgpKey } from '../lib/pgp';

/* The key as a file, so it can be piped straight into gpg. */
export const GET: APIRoute = () =>
  new Response(`${pgpKey}\n`, {
    headers: { 'Content-Type': 'application/pgp-keys; charset=utf-8' },
  });
