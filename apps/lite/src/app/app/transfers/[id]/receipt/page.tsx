import type { Metadata } from 'next';

import { Logo } from '@/components/logo';
import { PrintButton } from '@/components/customer/print-button';
import { LinkButton, StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { getReceipt } from '@/server/receipts';

import { orNotFound, uuidParam } from '../../../_lib/page';

export const metadata: Metadata = { title: 'Receipt' };

/**
 * Printable receipt (HTML). `getReceipt` applies the same access rule as the tracking page:
 * the sender, or the recipient once the money arrived — anyone else gets the 404 page.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const id = uuidParam((await params).id);
  const receipt = await orNotFound(() => getReceipt(ctx, id));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <LinkButton href={`/app/transfers/${id}`} variant="ghost" size="sm">
          ← Back to the transfer
        </LinkButton>
        <div className="flex flex-wrap gap-2">
          <PrintButton size="sm">Print</PrintButton>
          <a
            href={`/app/transfers/${id}/receipt/pdf`}
            download
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border-strong bg-surface-raised px-3 text-sm font-medium text-fg hover:bg-surface-muted"
          >
            Download PDF
          </a>
        </div>
      </div>

      <article className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-6 shadow-[var(--shadow-card)] sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <Logo />
            <p className="mt-2 text-xs text-fg-subtle">{receipt.appName} — transaction receipt</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-fg">{receipt.typeLabel}</h1>
            <p className="mt-0.5 font-mono text-sm text-fg-muted">{receipt.reference}</p>
            <p className="mt-1.5">
              <StatusBadge status={receipt.status} label={receipt.statusLabel} />
            </p>
          </div>
        </header>

        {receipt.sections.map((section) => (
          <section key={section.title} className="border-b border-border py-4 last:border-b-0">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {section.title}
            </h2>
            <dl className="space-y-1.5 text-sm">
              {section.lines.map((line) => (
                <div key={line.label} className="flex items-start justify-between gap-6">
                  <dt className="text-fg-muted">{line.label}</dt>
                  <dd
                    className={`tabular break-words text-right text-fg ${line.emphasis ? 'text-base font-semibold' : ''}`}
                  >
                    {line.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <footer className="pt-4 text-xs text-fg-muted">
          <ul className="space-y-1">
            {receipt.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-3 text-fg-subtle">
            Issued {formatDateTime(new Date())} · This receipt can be checked against reference{' '}
            {receipt.reference} in your BI-Rem Lite transfer history.
          </p>
        </footer>
      </article>
    </div>
  );
}
