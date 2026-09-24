import { TokenPasswordForm } from "@/components/shell/token-password-form";
import { getT } from "@/i18n";

export const metadata = { title: "Activate account" };

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  return <TokenPasswordForm token={token} title={t("auth.activate")} />;
}
