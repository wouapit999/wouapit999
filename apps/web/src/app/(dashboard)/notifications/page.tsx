import type { Metadata } from 'next';

import { NotificationsView } from '@/components/dashboard/notifications-view';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.notifications') };
}

export default function NotificationsPage() {
  return <NotificationsView />;
}
