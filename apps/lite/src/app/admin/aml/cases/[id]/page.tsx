import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

/** Notification links use /admin/aml/cases/<id>; the case page lives under /admin/compliance. */
export default async function AmlCaseRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/admin/compliance/cases/${id}`);
}
