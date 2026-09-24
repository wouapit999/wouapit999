import { requireTenantPortal } from "@/lib/auth/context";
import { AppShell } from "@/components/shell/app-shell";
import { PORTAL_NAV } from "@/components/shell/nav";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await requireTenantPortal();
  return <AppShell ctx={ctx} sections={[{ items: PORTAL_NAV }]}>{children}</AppShell>;
}
