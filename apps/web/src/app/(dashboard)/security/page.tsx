import type { Metadata } from 'next';

import { SecurityView } from '@/components/dashboard/security-view';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.security') };
}

export default function SecurityPage() {
  return <SecurityView />;
}
