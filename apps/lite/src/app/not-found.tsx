import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main
      data-page-state="not-found"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6 text-center"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The page you are looking for does not exist, has moved, or you do not have access to it.
      </p>
      <LinkButton href="/" variant="secondary">
        Back to home
      </LinkButton>
    </main>
  );
}
