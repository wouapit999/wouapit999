import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from '@/components/auth/login-form';
import { EnvBadge } from '@/components/shell/env-badge';
import { Logo } from '@/components/shell/logo';
import { publicEnv } from '@/env';
import { safeNextPath } from '@/lib/routes';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = typeof params.next === 'string' ? params.next : undefined;
  const next = rawNext ? safeNextPath(rawNext) : undefined;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-surface-sidebar p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-gold-500/20 blur-3xl"
        />
        <Logo />
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            Operate {publicEnv.NEXT_PUBLIC_APP_NAME} with confidence.
          </h1>
          <p className="text-sm leading-relaxed text-white/70">
            Manage users and roles, review the audit trail, tune feature flags and notification
            templates. Every action is attributed to you and recorded.
          </p>
        </div>
        <p className="text-xs text-white/50">
          Phase 1 foundation · identity, access and configuration
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Logo />
            <EnvBadge />
          </div>
          <div className="mb-6">
            <div className="mb-2 hidden lg:block">
              <EnvBadge />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-fg-muted">Use your administrator credentials.</p>
          </div>
          <Suspense>
            <LoginForm next={next} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
