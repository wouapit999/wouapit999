import { redirect } from 'next/navigation';

/** Old path kept for links emitted by the services: the AML workspace lives at /admin/compliance. */
export default function AmlRedirect(): never {
  redirect('/admin/compliance');
}
