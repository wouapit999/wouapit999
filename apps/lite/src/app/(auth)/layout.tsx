import type { ReactNode } from 'react';

import { PublicShell } from '@/components/shell/public-shell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell>
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 sm:py-14">{children}</div>
    </PublicShell>
  );
}
