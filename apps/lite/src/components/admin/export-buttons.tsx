import { buttonClasses } from '@/components/ui';

import { hrefWith } from './helpers';

const FORMATS = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
] as const;

/**
 * Download links for one named report in the three formats. They hit `/api/exports/<name>`,
 * which authenticates, checks `reports:export` and audits the export.
 */
export function ExportButtons({
  name,
  label,
  from,
  to,
  days,
}: {
  name: string;
  label: string;
  from?: string;
  to?: string;
  days?: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm text-fg">{label}</span>
      <span className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label: formatLabel }) => (
          <a
            key={format}
            href={hrefWith(`/api/exports/${name}`, { format, from, to, days })}
            download
            className={buttonClasses('secondary', 'sm')}
            data-export={`${name}.${format}`}
          >
            {formatLabel}
            <span className="sr-only"> export of {label}</span>
          </a>
        ))}
      </span>
    </div>
  );
}
