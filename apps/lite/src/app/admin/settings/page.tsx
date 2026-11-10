import type { Metadata } from 'next';

import {
  ActionForm,
  Badge,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  PageHeader,
  SubmitButton,
  Textarea,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { listSettings } from '@/server/settings';

import { setSettingAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };

/** Platform settings: typed key / value pairs, each validated by its own schema. */
export default async function SettingsPage() {
  await requirePermission('settings:write');
  const { ctx } = await getPageContext('ADMIN');
  const settings = await listSettings(ctx);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Operational parameters of the platform. Values are JSON; an invalid value is refused and the current one stays in force. Every change is audited."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {settings.map((setting) => {
          const text = JSON.stringify(setting.value, null, 2);
          return (
            <Card key={setting.key} data-setting={setting.key}>
              <CardHeader
                title={<code className="text-sm">{setting.key}</code>}
                description={setting.description}
                action={
                  <Badge tone={setting.isDefault ? 'neutral' : 'brand'}>
                    {setting.isDefault ? 'Default' : 'Customised'}
                  </Badge>
                }
              />
              <CardBody>
                <ActionForm action={setSettingAction} className="space-y-3">
                  <input type="hidden" name="key" value={setting.key} />
                  <Textarea
                    name="value"
                    label="Value (JSON)"
                    required
                    rows={Math.min(Math.max(text.split('\n').length, 2), 14)}
                    defaultValue={text}
                    spellCheck={false}
                    className="font-mono text-xs"
                    hint={
                      setting.updatedAt
                        ? `Last changed ${formatDateTime(setting.updatedAt)}`
                        : `Default: ${JSON.stringify(setting.defaultValue).slice(0, 80)}`
                    }
                  />
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
