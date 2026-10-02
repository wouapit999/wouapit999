import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { visibleSections } from "./sections";

export default async function AdminIndexPage() {
  const ctx = await requireContext();
  const first = visibleSections(ctx.permissions)[0];
  redirect(first ? `/admin/${first.slug}` : "/unauthorized");
}
