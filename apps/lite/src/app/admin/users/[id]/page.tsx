import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

/** The account 360° view lives under /admin/customers (it also serves partner and staff users). */
export default async function UserRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/admin/customers/${id}`);
}
