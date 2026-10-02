import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { AppShell } from "@/components/shell/app-shell";
import { STAFF_NAV } from "@/components/shell/nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  // Portal-only users (tenants, occupants) never see the staff shell.
  if (!ctx.permissions.has("dashboard.view") && !ctx.permissions.has("platform.organizations.manage") && ctx.permissions.has("portal.access")) {
    redirect("/portal/home");
  }
  return <AppShell ctx={ctx} sections={STAFF_NAV}>{children}</AppShell>;
}
