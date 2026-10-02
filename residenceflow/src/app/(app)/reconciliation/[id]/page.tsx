import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { InlineAction } from "@/components/forms";
import { Alert, Badge, Card, DescriptionList, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { coerceLines, matchedTotal, statementTotal } from "@/domain/reconciliation";
import { completeSessionAction, unmatchLineAction } from "../actions";
import { candidatePayments } from "../queries";
import { reconciliationMessages } from "../messages";
import { MatchLineForm } from "./match-form";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("payment.approve");
  const { t, locale } = await getT(reconciliationMessages);
  const session = await db.reconciliationSession.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!session) notFound();
  const lines = coerceLines(session.statementLines);
  const settings = await getOrgSettings(ctx.organizationId);
  const [candidates, creator] = await Promise.all([
    candidatePayments(ctx, session.periodStart, session.periodEnd),
    session.createdById ? db.user.findFirst({ where: { id: session.createdById, organizationId: ctx.organizationId }, select: { name: true } }) : null,
  ]);
  const matchedIds = new Set(lines.filter((l) => l.matched && l.paymentId).map((l) => l.paymentId as string));
  const referenced = [...matchedIds].filter((pid) => !candidates.some((c) => c.id === pid));
  const extra = referenced.length ? await db.payment.findMany({ where: { organizationId: ctx.organizationId, id: { in: referenced } }, select: { id: true, reference: true, externalRef: true, amount: true, paymentDate: true } }) : [];
  const paymentById = new Map([...candidates, ...extra.map((p) => ({ ...p, amount: p.amount.toString() }))].map((p) => [p.id, p]));
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const dt = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const open = session.status === "OPEN";
  const unmatchedPayments = candidates.filter((p) => !matchedIds.has(p.id));
  const missing = unmatchedPayments.filter((p) => p.paymentDate >= session.periodStart && p.paymentDate <= session.periodEnd);
  const matched = lines.filter((l) => l.matched).length;
  const paymentLabel = (p: { reference: string; externalRef: string | null; amount: string | { toString(): string }; paymentDate: Date }) =>
    `${p.reference}${p.externalRef ? ` / ${p.externalRef}` : ""} · ${formatMoney(p.amount, fmt)} · ${formatDay(p.paymentDate, prefs)}`;
  const options = unmatchedPayments.map((p) => ({ value: p.id, label: paymentLabel(p) }));

  return (
    <>
      <PageHeader
        title={`${t("rec.session")} · ${session.account}`}
        description={`${formatDay(session.periodStart, prefs)} → ${formatDay(session.periodEnd, prefs)}`}
        breadcrumbs={[{ label: t("rec.title"), href: "/reconciliation" }, { label: session.account }]}
        actions={
          <>
            <Badge status={session.status}>{t(`rec.status.${session.status}`)}</Badge>
            {open && <InlineAction action={completeSessionAction} label={t("rec.complete")} variant="primary" confirm={t("rec.completeConfirm")} hidden={{ sessionId: session.id }} />}
          </>
        }
      />
      {!open && <div className="mb-4"><Alert tone="info">{t("rec.readOnly")}</Alert></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("rec.lines")} value={lines.length} />
        <Stat label={t("rec.matched")} value={matched} tone="good" />
        <Stat label={t("rec.unmatched")} value={lines.length - matched} tone={lines.length - matched ? "warn" : "default"} />
        <Stat label={t("rec.matchedTotal")} value={formatMoney(matchedTotal(lines), fmt)} hint={`${t("rec.statementTotal")}: ${formatMoney(statementTotal(lines), fmt)}`} />
      </div>
      <div className="space-y-4">
        <Card title={t("rec.lines")}>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t("common.date")}</Th>
                <Th>{t("rec.reference")}</Th>
                <Th className="text-right">{t("common.amount")}</Th>
                <Th>{t("rec.description")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("rec.payment")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {lines.map((l, i) => {
                const p = l.paymentId ? paymentById.get(l.paymentId) : undefined;
                return (
                  <Tr key={i}>
                    <Td className="text-slate-500">{i + 1}</Td>
                    <Td className="whitespace-nowrap">{formatDay(new Date(`${l.date}T00:00:00Z`), prefs)}</Td>
                    <Td className="font-mono text-xs">{l.reference || "—"}</Td>
                    <Td className="text-right whitespace-nowrap">{formatMoney(l.amount, fmt)}</Td>
                    <Td className="max-w-xs"><span className="block truncate" title={l.description}>{l.description || "—"}</span></Td>
                    <Td>
                      {l.matched ? (
                        <Badge tone="green">{t("rec.matched")}{l.matchType ? ` · ${t(`rec.matchType.${l.matchType}`)}` : ""}</Badge>
                      ) : (
                        <Badge tone="amber">{t("rec.unmatched")}</Badge>
                      )}
                    </Td>
                    <Td>
                      {l.matched && l.paymentId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="text-[var(--brand)] hover:underline" href={`/payments/${l.paymentId}`}>{p ? paymentLabel(p) : l.paymentId}</Link>
                          {open && <InlineAction action={unmatchLineAction} label={t("rec.unmatch")} variant="ghost" hidden={{ sessionId: session.id, line: String(i) }} />}
                        </div>
                      ) : open ? (
                        <MatchLineForm sessionId={session.id} line={i} options={options} labels={{ choose: t("rec.choosePayment"), match: t("rec.match"), none: t("rec.noCandidates") }} />
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card title={t("rec.missing")}>
          <p className="mb-3 text-xs text-slate-500">{t("rec.missingHint")}</p>
          {missing.length === 0 ? (
            <p className="text-sm text-slate-500">{t("rec.noMissing")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("rec.payment")}</Th>
                  <Th>{t("common.date")}</Th>
                  <Th className="text-right">{t("common.amount")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {missing.map((p) => (
                  <Tr key={p.id}>
                    <Td><Link className="text-[var(--brand)] hover:underline" href={`/payments/${p.id}`}>{p.reference}</Link>{p.externalRef ? <span className="ml-1 font-mono text-xs text-slate-500">{p.externalRef}</span> : null}</Td>
                    <Td className="whitespace-nowrap">{formatDay(p.paymentDate, prefs)}</Td>
                    <Td className="text-right whitespace-nowrap">{formatMoney(p.amount, fmt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("rec.summary")}>
          <DescriptionList
            items={[
              { label: t("rec.account"), value: session.account },
              { label: t("rec.period"), value: `${formatDay(session.periodStart, prefs)} → ${formatDay(session.periodEnd, prefs)}` },
              { label: t("rec.createdBy"), value: creator?.name ?? "—" },
              { label: t("rec.completedAt"), value: session.completedAt ? formatDateTime(session.completedAt, dt) : "—" },
              { label: t("rec.notes"), value: session.notes ? <span className="whitespace-pre-wrap">{session.notes}</span> : "—" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
