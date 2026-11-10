import type { Metadata } from 'next';

import { PublicShell } from '@/components/shell/public-shell';
import { Card, LinkButton } from '@/components/ui';

export const metadata: Metadata = { title: 'Application received' };

/** Confirmation after a partner application. Static: it shows nothing about the applicant. */
export default function PartnerApplicationSubmittedPage() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-xl px-4 py-12 sm:py-16">
        <Card padded>
          <div
            aria-hidden="true"
            className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Application received</h1>
          <p className="mt-2 text-fg-muted">
            Thank you. Your partner account has been created and is <strong>pending review</strong>{' '}
            by a BI-Rem administrator.
          </p>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
            <li>Sign in with the e-mail and password you just chose to follow the status.</li>
            <li>
              Payments, API keys and webhooks switch on when the application is approved; you are
              notified in the portal.
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="/login">Sign in to the partner portal</LinkButton>
            <LinkButton href="/" variant="ghost">
              Back to the home page
            </LinkButton>
          </div>
        </Card>
      </div>
    </PublicShell>
  );
}
