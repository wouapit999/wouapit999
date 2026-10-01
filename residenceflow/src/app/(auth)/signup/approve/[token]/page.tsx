import { getT } from "@/i18n";
import { Alert, Badge, DescriptionList } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CODE_TTL_MINUTES, findByApprovalToken } from "@/services/signup-requests";
import { signupMessages } from "../../messages";
import { ApproveForm } from "./approve-form";

export const metadata = { title: "Access request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Operator page reached from the notification email; the link token is the credential. */
export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT(signupMessages);
  const req = await findByApprovalToken(token);
  const tz = { timezone: process.env.DEFAULT_TIMEZONE || "Africa/Douala", dateFormat: "dd/MM/yyyy" };
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.approve.title")}</h1>
      {!req ? (
        <Alert tone="error">{t("signup.notFound")}</Alert>
      ) : (
        <>
          <div className="mb-4"><Badge status={req.status === "USED" ? "ACTIVE" : req.status}>{t(`signup.status.${req.status}`)}</Badge></div>
          <DescriptionList items={[
            { label: t("signup.requests.applicant"), value: `${req.name} <${req.email}>` },
            { label: t("signup.requests.enterprise"), value: req.orgName },
            { label: t("signup.requests.received"), value: formatDateTime(req.createdAt, tz) },
          ]} />
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{t("signup.approve.body", { minutes: CODE_TTL_MINUTES })}</p>
          <div className="mt-4">
            <ApproveForm
              token={token}
              decided={req.status === "USED" || req.status === "REJECTED"}
              labels={{
                approve: t("signup.approve.approve"), reject: t("signup.approve.reject"),
                done: t("signup.approve.done", { email: req.email, time: "{time}" }),
                notEmailed: t("signup.approve.notEmailed", { time: "{time}" }),
                rejected: t("signup.approve.rejected"),
              }}
              tz={tz.timezone}
            />
          </div>
        </>
      )}
    </div>
  );
}
