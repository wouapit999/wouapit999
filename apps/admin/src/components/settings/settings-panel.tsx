'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckboxField, TextField, TextareaField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, THead, Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { formatWhen } from '@/lib/format';
import { useSettings, useUpsertSetting } from '@/lib/queries';
import { type Setting, settingKeySchema, upsertSettingSchema } from '@/lib/schemas';

const MASK = '••••••••';

/** Raw JSON values are entered as JSON; anything that fails to parse is stored as a string. */
export function parseSettingValue(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return input;
  }
}

export function displaySettingValue(setting: Setting): string {
  if (setting.isSecret) return MASK;
  if (setting.value === null) return 'null';
  if (typeof setting.value === 'string') return setting.value;
  return JSON.stringify(setting.value);
}

const settingFormSchema = z.object({
  key: settingKeySchema,
  value: z.string(),
  description: z.string().trim().max(500),
  isSecret: z.boolean(),
});
type SettingFormValues = z.infer<typeof settingFormSchema>;

type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; setting: Setting };

export function SettingsPanel() {
  const canWrite = useCan('settings:write');
  const settings = useSettings();
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' });

  if (settings.isPending) return <LoadingState label="Loading settings…" />;
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Key/value platform configuration. Secret values are encrypted at rest and never returned
          to the browser.
        </p>
        {canWrite ? (
          <Button
            size="sm"
            onClick={() => setEditor({ mode: 'create' })}
            leadingIcon={<Icon name="plus" className="h-4 w-4" />}
          >
            Add setting
          </Button>
        ) : null}
      </div>
      {settings.data.length === 0 ? (
        <EmptyState title="No settings yet" body="Add the first setting or run the API seed." />
      ) : (
        <TableContainer>
          <Table caption="Platform settings">
            <THead>
              <tr>
                <Th>Key</Th>
                <Th>Value</Th>
                <Th>Description</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {settings.data.map((setting) => (
                <Tr key={setting.id}>
                  <Td className="align-top">
                    <code className="font-mono text-sm font-medium text-fg">{setting.key}</code>
                  </Td>
                  <Td className="max-w-md align-top">
                    <span className="flex items-center gap-2">
                      <code
                        className="truncate font-mono text-xs text-fg"
                        title={setting.isSecret ? undefined : displaySettingValue(setting)}
                      >
                        {displaySettingValue(setting)}
                      </code>
                      {setting.isSecret ? (
                        <Badge tone="warning">
                          <Icon name="lock" className="h-3 w-3" /> Secret
                        </Badge>
                      ) : null}
                    </span>
                  </Td>
                  <Td className="max-w-sm align-top text-fg-muted">{setting.description ?? '—'}</Td>
                  <Td className="align-top text-fg-muted whitespace-nowrap">
                    {formatWhen(setting.updatedAt)}
                  </Td>
                  <Td className="align-top">
                    <div className="flex justify-end">
                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditor({ mode: 'edit', setting })}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
      {editor.mode !== 'closed' && canWrite ? (
        <SettingDialog
          setting={editor.mode === 'edit' ? editor.setting : null}
          onClose={() => setEditor({ mode: 'closed' })}
        />
      ) : null}
    </div>
  );
}

function SettingDialog({ setting, onClose }: { setting: Setting | null; onClose: () => void }) {
  const upsert = useUpsertSetting();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<SettingFormValues>({
    resolver: zodResolver(settingFormSchema),
    defaultValues: {
      key: setting?.key ?? '',
      value: setting && !setting.isSecret ? displaySettingValue(setting) : '',
      description: setting?.description ?? '',
      isSecret: setting?.isSecret ?? false,
    },
  });
  const { run, formError, submitting } = useSubmit<SettingFormValues>(setError);
  const isSecret = useWatch({ control, name: 'isSecret' });

  const onSubmit = handleSubmit(async (values) => {
    if (setting?.isSecret && values.value === '') {
      setError('value', {
        type: 'validate',
        message: 'Enter the new secret value; the current one cannot be shown.',
      });
      return;
    }
    const dto = upsertSettingSchema.parse({
      value: parseSettingValue(values.value),
      ...(values.description ? { description: values.description } : {}),
      isSecret: values.isSecret,
    });
    const result = await run(
      () => upsert.mutateAsync({ key: values.key, dto }),
      ['key', 'value', 'description', 'isSecret'],
    );
    if (result) onClose();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={setting ? `Edit ${setting.key}` : 'Add setting'}
      description="Values are JSON when they parse (numbers, booleans, objects) and strings otherwise."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="setting-form" type="submit" loading={submitting} loadingLabel="Saving">
            Save setting
          </Button>
        </>
      }
    >
      <form id="setting-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <TextField
          label="Key"
          placeholder="platform.support-email"
          className="font-mono"
          autoComplete="off"
          disabled={setting !== null}
          hint={setting ? undefined : 'Dotted lowercase, e.g. auth.max-failed-logins'}
          error={errors.key?.message}
          {...register('key')}
        />
        <TextareaField
          label="Value"
          rows={4}
          placeholder={
            isSecret ? 'Enter the secret value' : '"support@bi-rem.com" or 5 or {"a": 1}'
          }
          hint={
            setting?.isSecret
              ? 'The stored secret is never shown; enter the complete new value.'
              : undefined
          }
          autoComplete="off"
          error={errors.value?.message}
          {...register('value')}
        />
        <TextField
          label="Description"
          optional
          error={errors.description?.message}
          {...register('description')}
        />
        <CheckboxField
          label="Secret"
          description="Encrypted at rest and masked everywhere in the admin portal."
          disabled={setting?.isSecret ?? false}
          {...register('isSecret')}
        />
      </form>
    </Dialog>
  );
}
