import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { CODE_TTL_MINUTES, listRequests, supportEmail } from "@/services/signup-requests";
import { signupMessages } from "@/app/(auth)/signup/messages";
import { platformMessages } from "../messages";
import { RequestActions } from "./request-actions";

export const metadata = { title: "Access requests" };
export const dynamic = "force-dynamic";

export default async function AccessRequestsPage() {
  await requireContext("platform.organizations.manage");
  const { t } = await getT(signupMessages, platformMessages);
  const rows = await listRequests();
  const tz = { timezone: process.env.DEFAULT_TIMEZONE || "Africa/Douala", dateFormat: "dd/MM/yyyy" };
  return (
    <>
      <PageHeader
        title={t("signup.requests.title")}
        description={t("signup.requests.subtitle", { support: supportEmail(), minutes: CODE_TTL_MINUTES })}
        breadcrumbs={[{ label: t("nav.platform"), href: "/platform" }, { label: t("signup.requests.title") }]}
      />
      {rows.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("signup.requests.received")}</Th>
              <Th>{t("signup.requests.applicant")}</Th>
              <Th>{t("signup.requests.enterprise")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("common.actions")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, tz)}</Td>
                <Td>{r.name}<div className="text-xs text-slate-500">{r.email}</div></Td>
                <Td>{r.orgName}</Td>
                <Td>
                  <Badge status={r.status === "USED" ? "ACTIVE" : r.status}>{t(`signup.status.${r.status}`)}</Badge>
                  {r.status === "APPROVED" && r.codeExpiresAt && <div className="text-xs text-slate-500">→ {formatDateTime(r.codeExpiresAt, { ...tz, dateFormat: "HH:mm" })}</div>}
                </Td>
                <Td>
                  <RequestActions
                    id={r.id}
                    canDecide={r.status === "PENDING" || r.status === "APPROVED" || r.status === "EXPIRED"}
                    labels={{ approve: t("signup.approve.approve"), reject: t("signup.approve.reject"), done: t("signup.approve.done", { email: r.email, time: "{time}" }), notEmailed: t("signup.approve.notEmailed", { time: "{time}" }) }}
                    tz={tz.timezone}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
