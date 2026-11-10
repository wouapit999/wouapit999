import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Alert, Card } from '@/components/ui';
import { getSession } from '@/server/auth/session';
import { getEnv } from '@/server/env';
import { homePathForRole } from '@/server/rbac';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const DEMO_PASSWORD = 'ChangeMe123!';
const DEMO_ADMIN = { email: 'admin@bi-rem.local', note: 'administrator' };

const DEMO_ACCOUNTS: ReadonlyArray<{ email: string; note: string }> = [
  { email: 'amina@example.com', note: 'customer, Cameroon, verified' },
  { email: 'joao@example.com', note: 'customer, Angola, verified' },
  { email: 'maria@example.com', note: 'customer, Mozambique, KYC pending' },
  { email: 'compliance@bi-rem.local', note: 'compliance officer' },
  { email: 'treasury@bi-rem.local', note: 'treasury officer' },
  { email: 'support@bi-rem.local', note: 'support agent' },
  { email: 'partner@bi-rem.local', note: 'partner (demo merchant)' },
  { email: 'agent@bi-rem.local', note: 'partner (demo agent: float, cash-in, cash-out)' },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(homePathForRole(session.user.role));
  const { next } = await searchParams;
  const env = getEnv();
  // The administrator is a demo account only while it still has the public default credentials
  // (never the case in production, where SEED_ADMIN_PASSWORD is mandatory).
  const adminIsDemo =
    env.seedAdminEmail === DEMO_ADMIN.email && env.seedAdminPassword === DEMO_PASSWORD;
  const demoAccounts = adminIsDemo ? [...DEMO_ACCOUNTS, DEMO_ADMIN] : DEMO_ACCOUNTS;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Customers, partners and staff all sign in here.</p>
      <Card padded className="mt-6">
        <LoginForm next={next} />
      </Card>
      <p className="mt-4 text-center text-sm text-fg-muted">
        New to BI-Rem?{' '}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
      {env.seedDemoData ? (
        <Alert tone="info" title="Demo accounts" className="mt-6">
          <p>
            Password for all of them: <code className="font-mono">{DEMO_PASSWORD}</code>
          </p>
          <ul className="mt-2 space-y-0.5">
            {demoAccounts.map((account) => (
              <li key={account.email}>
                <code className="font-mono text-xs">{account.email}</code>
                <span className="text-fg-muted"> — {account.note}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}
