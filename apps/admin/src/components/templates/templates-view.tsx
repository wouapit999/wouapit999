'use client';

import { useMemo, useState } from 'react';

import { useCan } from '@/components/shell/session-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { INPUT_CLASSES } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, THead, Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { formatWhen, humanizeEnum } from '@/lib/format';
import { useTemplates } from '@/lib/queries';
import type { NotificationTemplate } from '@/lib/schemas';

import { TemplateEditorDialog } from './template-editor-dialog';

type Editor =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; template: NotificationTemplate };

const CHANNEL_TONE = { EMAIL: 'brand', SMS: 'gold', PUSH: 'info', IN_APP: 'neutral' } as const;

export function TemplatesView() {
  const canWrite = useCan('notification-templates:write');
  const templates = useTemplates();
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' });
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const rows = (templates.data ?? []).filter(
      (template) =>
        !term ||
        template.key.includes(term) ||
        template.channel.toLowerCase().includes(term) ||
        template.locale.includes(term),
    );
    const groups = new Map<string, NotificationTemplate[]>();
    for (const template of rows) {
      const list = groups.get(template.key) ?? [];
      list.push(template);
      groups.set(template.key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [templates.data, filter]);

  return (
    <>
      <PageHeader
        title="Notification templates"
        description="Email, SMS, push and in-app templates per locale, identified by key + channel + locale."
        actions={
          canWrite ? (
            <Button
              onClick={() => setEditor({ mode: 'create' })}
              leadingIcon={<Icon name="plus" className="h-4 w-4" />}
            >
              New template
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 max-w-sm">
        <label htmlFor="templates-filter" className="sr-only">
          Filter templates
        </label>
        <input
          id="templates-filter"
          type="search"
          placeholder="Filter by key, channel or locale…"
          className={INPUT_CLASSES}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {templates.isPending ? (
        <LoadingState label="Loading templates…" />
      ) : templates.isError ? (
        <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState
          title={filter ? 'No templates match' : 'No templates yet'}
          body={
            filter
              ? 'Try a different key, channel or locale.'
              : 'Create the first template to start sending notifications.'
          }
        />
      ) : (
        <TableContainer>
          <Table caption="Notification templates grouped by key">
            <THead>
              <tr>
                <Th>Key</Th>
                <Th>Channel</Th>
                <Th>Locale</Th>
                <Th>Variables</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {grouped.map(([key, items]) =>
                items.map((template, index) => (
                  <Tr key={template.id}>
                    <Td className={index === 0 ? 'font-medium' : 'text-fg-subtle'}>
                      <code className="font-mono text-xs">{index === 0 ? key : '↳'}</code>
                    </Td>
                    <Td>
                      <Badge tone={CHANNEL_TONE[template.channel]}>
                        {humanizeEnum(template.channel)}
                      </Badge>
                    </Td>
                    <Td>{template.locale.toUpperCase()}</Td>
                    <Td className="max-w-56">
                      <span className="flex flex-wrap gap-1">
                        {template.variables.length === 0 ? (
                          <span className="text-xs text-fg-subtle">None</span>
                        ) : (
                          template.variables.map((variable) => (
                            <code
                              key={variable}
                              className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                            >
                              {variable}
                            </code>
                          ))
                        )}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={template.isActive ? 'success' : 'neutral'} dot>
                        {template.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td className="text-fg-muted whitespace-nowrap">
                      {formatWhen(template.updatedAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditor({ mode: 'edit', template })}
                        >
                          {canWrite ? 'Edit' : 'View'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                )),
              )}
            </TBody>
          </Table>
        </TableContainer>
      )}
      {editor.mode === 'closed' ? null : canWrite ? (
        <TemplateEditorDialog
          template={editor.mode === 'edit' ? editor.template : null}
          onClose={() => setEditor({ mode: 'closed' })}
        />
      ) : editor.mode === 'edit' ? (
        <TemplatePreviewDialog
          template={editor.template}
          onClose={() => setEditor({ mode: 'closed' })}
        />
      ) : null}
    </>
  );
}

function TemplatePreviewDialog({
  template,
  onClose,
}: {
  template: NotificationTemplate;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={template.key}
      description={`${humanizeEnum(template.channel)} · ${template.locale.toUpperCase()}`}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {template.subject ? <p className="text-sm font-medium">{template.subject}</p> : null}
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs whitespace-pre-wrap">
        {template.body}
      </pre>
    </Dialog>
  );
}
