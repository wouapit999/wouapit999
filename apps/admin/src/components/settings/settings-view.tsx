'use client';

import { useState } from 'react';

import { useSession } from '@/components/shell/session-provider';
import { PageHeader } from '@/components/ui/page-header';
import { ForbiddenState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';

import { ApiKeysPanel } from './api-keys-panel';
import { FeatureFlagsPanel } from './feature-flags-panel';
import { SettingsPanel } from './settings-panel';

type TabKey = 'flags' | 'settings' | 'api-keys';

export function SettingsView() {
  const { can } = useSession();
  const access: Record<TabKey, boolean> = {
    flags: can('feature-flags:read'),
    settings: can('settings:read'),
    'api-keys': can('api-keys:read'),
  };
  const first = (Object.keys(access) as TabKey[]).find((key) => access[key]);
  const [tab, setTab] = useState<TabKey>(first ?? 'flags');

  if (!first)
    return <ForbiddenState permission="feature-flags:read, settings:read or api-keys:read" />;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Feature flags, platform configuration and service-account API keys."
      />
      <Tabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'flags', label: 'Feature flags', disabled: !access.flags },
          { key: 'settings', label: 'Configuration', disabled: !access.settings },
          { key: 'api-keys', label: 'API keys', disabled: !access['api-keys'] },
        ]}
      >
        {tab === 'flags' ? (
          <FeatureFlagsPanel />
        ) : tab === 'settings' ? (
          <SettingsPanel />
        ) : (
          <ApiKeysPanel />
        )}
      </Tabs>
    </>
  );
}
