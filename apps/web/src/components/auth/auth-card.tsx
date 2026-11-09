import type { ReactNode } from 'react';

import { Logo } from '@/components/logo';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo compact className="scale-125" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      <div className="rounded-card border border-border bg-surface-raised p-6 shadow-card sm:p-8">
        {children}
      </div>
      {footer ? <div className="text-center text-sm text-fg-muted">{footer}</div> : null}
    </div>
  );
}
