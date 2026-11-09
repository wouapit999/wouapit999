import type { Metadata } from 'next';

import { ProfileView } from '@/components/dashboard/profile-view';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { getSession } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.profile') };
}

export default async function ProfilePage() {
  const session = await getSession();
  if (session.status !== 'authenticated') return null;
  return <ProfileView initialUser={session.user} />;
}
