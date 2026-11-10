import { redirect } from 'next/navigation';

/** `/app/topup` is the short link used by older navigation; the form lives under Wallets. */
export default function TopUpRedirect() {
  redirect('/app/wallets/topup');
}
