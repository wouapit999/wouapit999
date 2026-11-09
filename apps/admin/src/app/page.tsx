import { redirect } from 'next/navigation';

import { PAGES } from '@/lib/routes';

/** The portal has no public landing page; `proxy.ts` decides between login and dashboard. */
export default function IndexPage() {
  redirect(PAGES.dashboard);
}
