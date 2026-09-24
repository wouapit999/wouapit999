import { getT } from "@/i18n";
import { TokenPasswordForm } from "@/components/shell/token-password-form";

export const metadata = { title: "Reset password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  return <TokenPasswordForm token={token} title={t("auth.resetTitle")} />;
}
