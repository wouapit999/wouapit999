'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { NOTIFICATION_CHANNELS, SUPPORTED_LOCALES } from '@bi-rem/shared/constants';
import {
  localeSchema,
  notificationChannelSchema,
  zodIssuesToFieldErrors,
} from '@bi-rem/shared/schemas';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckboxField, SelectField, TextField, TextareaField } from '@/components/ui/field';
import { humanizeEnum } from '@/lib/format';
import { useUpsertTemplate } from '@/lib/queries';
import {
  type NotificationTemplate,
  notificationTemplateUpsertSchema,
  templateKeySchema,
} from '@/lib/schemas';

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

const templateFormSchema = z.object({
  key: templateKeySchema,
  channel: notificationChannelSchema,
  locale: localeSchema,
  subject: z.string().trim().max(255),
  body: z.string().min(1, { error: 'Required' }).max(20_000),
  /** Comma or whitespace separated identifiers. */
  variables: z.string(),
  isActive: z.boolean(),
});
type TemplateFormValues = z.infer<typeof templateFormSchema>;

const FIELDS = ['key', 'channel', 'locale', 'subject', 'body', 'variables'] as const;

export function parseVariables(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export function detectPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * Create or edit a template. Variables declared here must cover every `{{placeholder}}` used in
 * the subject/body; the hints panel shows which are missing or unused before the API does.
 */
export function TemplateEditorDialog({
  template,
  onClose,
}: {
  template: NotificationTemplate | null;
  onClose: () => void;
}) {
  const upsert = useUpsertTemplate();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      key: template?.key ?? '',
      channel: template?.channel ?? 'EMAIL',
      locale: template?.locale ?? 'en',
      subject: template?.subject ?? '',
      body: template?.body ?? '',
      variables: template?.variables.join(', ') ?? '',
      isActive: template?.isActive ?? true,
    },
  });
  const { run, formError, submitting, setFormError } = useSubmit<TemplateFormValues>(setError);

  const [channel, subject, body, variablesInput] = useWatch({
    control,
    name: ['channel', 'subject', 'body', 'variables'],
  });
  const declared = useMemo(() => parseVariables(variablesInput), [variablesInput]);
  const used = useMemo(() => detectPlaceholders(subject, body), [subject, body]);
  const missing = used.filter((name) => !declared.includes(name));
  const unused = declared.filter((name) => !used.includes(name));

  const onSubmit = handleSubmit(async (values) => {
    const candidate = {
      key: values.key,
      channel: values.channel,
      locale: values.locale,
      ...(values.subject ? { subject: values.subject } : {}),
      body: values.body,
      variables: parseVariables(values.variables),
      isActive: values.isActive,
    };
    const parsed = notificationTemplateUpsertSchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors = zodIssuesToFieldErrors(parsed.error);
      let shown = false;
      for (const fieldError of fieldErrors) {
        if ((FIELDS as readonly string[]).includes(fieldError.path)) {
          setError(fieldError.path as (typeof FIELDS)[number], {
            type: 'validate',
            message: fieldError.message,
          });
          shown = true;
        }
      }
      if (!shown) setFormError(fieldErrors.map((e) => e.message).join(' '));
      return;
    }
    const result = await run(() => upsert.mutateAsync(parsed.data), FIELDS);
    if (result) onClose();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? `Edit ${template.key}` : 'New template'}
      description={
        template
          ? `Replaces the ${humanizeEnum(template.channel)} / ${template.locale.toUpperCase()} template in place; the audit log keeps the previous body.`
          : 'A template is identified by key + channel + locale. Placeholders use {{variable}} syntax.'
      }
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="template-form"
            type="submit"
            loading={submitting}
            loadingLabel="Saving"
            disabled={missing.length > 0}
          >
            Save template
          </Button>
        </>
      }
    >
      <form
        id="template-form"
        onSubmit={onSubmit}
        noValidate
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <div className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Key"
              placeholder="auth.password-reset"
              className="font-mono"
              autoComplete="off"
              disabled={template !== null}
              hint={template ? undefined : 'Dotted lowercase, e.g. user.welcome'}
              error={errors.key?.message}
              {...register('key')}
            />
            <SelectField
              label="Channel"
              disabled={template !== null}
              options={NOTIFICATION_CHANNELS.map((value) => ({
                value,
                label: humanizeEnum(value),
              }))}
              error={errors.channel?.message}
              {...register('channel')}
            />
            <SelectField
              label="Locale"
              disabled={template !== null}
              options={SUPPORTED_LOCALES.map((value) => ({ value, label: value.toUpperCase() }))}
              error={errors.locale?.message}
              {...register('locale')}
            />
          </div>
          {channel === 'EMAIL' || subject ? (
            <TextField
              label="Subject"
              optional={channel !== 'EMAIL'}
              hint={channel === 'EMAIL' ? 'Required for email templates.' : undefined}
              error={errors.subject?.message}
              {...register('subject')}
            />
          ) : null}
          <TextareaField
            label="Body"
            rows={12}
            hint={
              channel === 'SMS'
                ? 'SMS bodies are limited to 1000 characters.'
                : 'Plain text or HTML; placeholders as {{name}}.'
            }
            error={errors.body?.message}
            {...register('body')}
          />
          <TextField
            label="Variables"
            placeholder="firstName, resetUrl, expiresInMinutes"
            hint="Comma-separated identifiers. Every placeholder used above must be declared."
            className="font-mono text-xs"
            error={errors.variables?.message}
            {...register('variables')}
          />
          <CheckboxField
            label="Active"
            description="Inactive templates are kept but never rendered."
            {...register('isActive')}
          />
        </div>

        <aside
          aria-label="Variable hints"
          className="space-y-4 rounded-lg border border-border bg-surface p-4 text-sm"
        >
          <div>
            <p className="font-medium text-fg">Placeholders in use</p>
            {used.length === 0 ? (
              <p className="mt-1 text-xs text-fg-muted">None detected yet.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {used.map((name) => (
                  <li key={name}>
                    <Badge tone={declared.includes(name) ? 'success' : 'danger'}>
                      <code className="font-mono">{`{{${name}}}`}</code>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {missing.length > 0 ? (
            <Alert tone="warning" title="Undeclared placeholders">
              <p className="mb-2">
                The API rejects placeholders that are not declared as variables.
              </p>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() =>
                  setValue('variables', [...declared, ...missing].join(', '), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                Declare {missing.length === 1 ? missing[0] : `${missing.length} variables`}
              </Button>
            </Alert>
          ) : null}
          {unused.length > 0 ? (
            <div>
              <p className="font-medium text-fg">Declared but unused</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {unused.map((name) => (
                  <li key={name}>
                    <Badge tone="neutral">
                      <code className="font-mono">{name}</code>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="font-medium text-fg">Common variables</p>
            <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
              <li>
                <code className="font-mono">firstName</code>,{' '}
                <code className="font-mono">lastName</code> — recipient
              </li>
              <li>
                <code className="font-mono">appName</code>,{' '}
                <code className="font-mono">supportEmail</code> — platform
              </li>
              <li>
                <code className="font-mono">actionUrl</code>,{' '}
                <code className="font-mono">code</code> — call to action
              </li>
              <li>
                <code className="font-mono">expiresInMinutes</code> — token lifetime
              </li>
            </ul>
          </div>
        </aside>
      </form>
    </Dialog>
  );
}
