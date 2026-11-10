import { permanentRedirect } from 'next/navigation';

/** `/partners/apply` is the address the landing page and footer link to; the form lives at /apply. */
export default function PartnersApplyRedirect(): never {
  permanentRedirect('/apply');
}
