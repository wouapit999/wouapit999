import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";

export default async function Home() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.permissions.has("dashboard.view")) redirect("/dashboard");
  if (ctx.permissions.has("platform.organizations.manage")) redirect("/platform");
  redirect("/portal/home");
}
