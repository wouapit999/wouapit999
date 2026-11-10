import { redirect } from 'next/navigation';

/** Reconciliation is a section of the treasury page. */
export default function ReconciliationRedirect(): never {
  redirect('/admin/treasury#reconciliation');
}
