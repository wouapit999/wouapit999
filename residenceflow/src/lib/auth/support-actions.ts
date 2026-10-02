"use server";

import { redirect } from "next/navigation";
import { getContext } from "./context";
import { leaveSupportSession } from "@/services/support-access";

/** Ends the current support-access session and returns the platform administrator to the console. */
export async function endSupportAccessAction() {
  const ctx = await getContext();
  if (!ctx?.supportAccess) redirect("/login");
  const restored = await leaveSupportSession(ctx);
  redirect(restored ? "/platform" : "/login");
}
