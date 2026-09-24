import Link from "next/link";
import type { Notification } from "@prisma/client";
import type { T } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { InlineAction } from "@/components/forms";
import { Badge, EmptyState } from "@/components/ui";
import { markNotificationReadAction } from "@/app/(app)/notifications/actions";

/** List of the signed-in user's notifications (used by staff and portal pages). */
export function NotificationList({ rows, t, df, rewriteLink }: {
  rows: Notification[];
  t: T;
  df: { timezone: string; dateFormat?: string };
  /** Optional link rewrite (e.g. keep portal users inside /portal). */
  rewriteLink?: (link: string) => string | null;
}) {
  if (rows.length === 0) return <EmptyState title={t("notif.none")} />;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
      {rows.map((n) => {
        const link = n.link ? (rewriteLink ? rewriteLink(n.link) : n.link) : null;
        return (
          <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={n.readAt ? "text-sm text-slate-700 dark:text-slate-300" : "text-sm font-semibold text-slate-900 dark:text-white"}>{n.title}</span>
                {n.readAt ? <Badge tone="slate">{t("notif.read")}</Badge> : <Badge tone="blue">{t("notif.unread")}</Badge>}
              </div>
              {n.body && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.body}</p>}
              <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(n.createdAt, df)}</p>
            </div>
            <div className="flex items-center gap-2">
              {link && <Link href={link} className="text-sm text-[var(--brand)] hover:underline">{t("notif.open")}</Link>}
              {!n.readAt && <InlineAction action={markNotificationReadAction} label={t("notif.markRead")} variant="ghost" hidden={{ id: n.id }} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
