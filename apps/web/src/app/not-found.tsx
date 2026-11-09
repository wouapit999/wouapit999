import Link from 'next/link';

import { buttonClasses } from '@/components/ui/button';
import { PAGES } from '@/lib/routes';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The page you are looking for does not exist or has moved.
      </p>
      <Link href={PAGES.home} className={buttonClasses('secondary')}>
        Back to home
      </Link>
    </main>
  );
}
