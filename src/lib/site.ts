/*
  The handful of facts that more than one page states.

  The landing page counts them, /wall and /contact list them, and they
  are written once here so a number on the front page cannot drift away
  from the list it is counting.
*/

export const email = 'pytho13@proton.me';

export const profiles = [
  { name: 'HackTheBox', handle: '@Pytho', href: 'https://app.hackthebox.com/users/1710921' },
  { name: 'Intigriti', handle: '@pytho1', href: 'https://app.intigriti.com/profile/pytho1' },
  { name: 'HackerOne', handle: '@pytho1', href: 'https://hackerone.com/pytho1?type=user' },
];

/* Held certificates carry their scan; the ones being worked towards are
   an empty slot that says so, so the two can never be read as the same
   thing. Only the held ones are ever counted. */
export const certs = [
  { label: 'CompTIA Security+', src: '/images/cert-secplus.webp', status: 'held' as const },
  { label: 'HTB CPTS', src: null, status: 'in progress' as const },
];

export const handles = [
  { kind: 'github', handle: 'Pytho2535', href: 'https://github.com/Pytho2535' },
  { kind: 'x / twitter', handle: '@Pytho_01', href: 'https://x.com/Pytho_01' },
  { kind: 'intigriti', handle: '@pytho1', href: 'https://app.intigriti.com/profile/pytho1' },
  { kind: 'hackerone', handle: '@pytho1', href: 'https://hackerone.com/pytho1?type=user' },
  { kind: 'hackthebox', handle: '@Pytho', href: 'https://app.hackthebox.com/users/1710921' },
];

export const heldCerts = certs.filter((c) => c.status === 'held');
