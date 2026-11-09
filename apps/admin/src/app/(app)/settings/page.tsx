import type { Metadata } from 'next';

import { SettingsView } from '@/components/settings/settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  // The view gates each tab individually (flags / configuration / API keys).
  return <SettingsView />;
}
