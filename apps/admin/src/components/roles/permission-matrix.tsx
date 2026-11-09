'use client';

import { useId } from 'react';

import { cn } from '@/lib/cn';
import {
  type PermissionGroup,
  collectActions,
  groupPermissionsByResource,
  splitPermission,
} from '@/lib/permissions';

/**
 * Resource × action grid. Rows are resources (`users`, `roles`…), columns the union of actions.
 * A cell is a checkbox when the permission exists, blank otherwise. In read-only mode the grid
 * previews an effective permission set (e.g. the union of a user's roles).
 */
export function PermissionMatrix({
  available,
  selected,
  onChange,
  readOnly = false,
  descriptions,
  caption = 'Permissions by resource and action',
}: {
  /** All permission codes that can be granted (from `GET /v1/permissions` or the shared list). */
  available: readonly string[];
  selected: ReadonlySet<string>;
  onChange?: (next: Set<string>) => void;
  readOnly?: boolean;
  descriptions?: ReadonlyMap<string, string | null>;
  caption?: string;
}) {
  const id = useId();
  const groups: PermissionGroup[] = groupPermissionsByResource(available);
  const actions = collectActions(groups);
  const editable = !readOnly && onChange !== undefined;

  const toggle = (permission: string, checked: boolean) => {
    if (!onChange) return;
    const next = new Set(selected);
    if (checked) next.add(permission);
    else next.delete(permission);
    onChange(next);
  };

  const toggleRow = (group: PermissionGroup, checked: boolean) => {
    if (!onChange) return;
    const next = new Set(selected);
    for (const permission of group.permissions) {
      if (checked) next.add(permission);
      else next.delete(permission);
    }
    onChange(next);
  };

  if (groups.length === 0) {
    return <p className="text-sm text-fg-muted">No permissions available.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted text-xs tracking-wide text-fg-subtle uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Resource
            </th>
            {actions.map((action) => (
              <th key={action} scope="col" className="px-3 py-2 text-center font-semibold">
                {action}
              </th>
            ))}
            {editable ? (
              <th scope="col" className="px-3 py-2 text-center font-semibold">
                All
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((group) => {
            const granted = group.permissions.filter((permission) =>
              selected.has(permission),
            ).length;
            const all = granted === group.permissions.length;
            return (
              <tr key={group.resource} className={cn(granted > 0 && 'bg-accent-soft/40')}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-fg">
                  {group.label}
                  <span className="ml-2 text-xs font-normal text-fg-subtle tabular-nums">
                    {granted}/{group.permissions.length}
                  </span>
                </th>
                {actions.map((action) => {
                  const permission = group.permissions.find(
                    (p) => splitPermission(p).action === action,
                  );
                  if (!permission) {
                    return (
                      <td
                        key={action}
                        className="px-3 py-2 text-center text-fg-subtle/40"
                        aria-hidden="true"
                      >
                        ·
                      </td>
                    );
                  }
                  const checked = selected.has(permission);
                  const description = descriptions?.get(permission) ?? undefined;
                  const cellId = `${id}-${permission}`;
                  return (
                    <td key={action} className="px-3 py-2 text-center">
                      {editable ? (
                        <input
                          id={cellId}
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={checked}
                          onChange={(event) => toggle(permission, event.target.checked)}
                          aria-label={`${permission}${description ? ` — ${description}` : ''}`}
                          title={description ?? permission}
                        />
                      ) : (
                        <span
                          role="img"
                          aria-label={`${permission}: ${checked ? 'granted' : 'not granted'}`}
                          title={permission}
                          className={cn(
                            'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                            checked
                              ? 'bg-success-soft text-success'
                              : 'bg-surface-muted text-fg-subtle/60',
                          )}
                        >
                          {checked ? '✓' : '–'}
                        </span>
                      )}
                    </td>
                  );
                })}
                {editable ? (
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={all}
                      onChange={(event) => toggleRow(group, event.target.checked)}
                      aria-label={`Toggle every ${group.label.toLowerCase()} permission`}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact chip list of permission codes, grouped by resource. */
export function PermissionChips({
  permissions,
  max = 12,
}: {
  permissions: readonly string[];
  max?: number;
}) {
  const sorted = groupPermissionsByResource(permissions).flatMap((group) => group.permissions);
  const shown = sorted.slice(0, max);
  const hidden = sorted.length - shown.length;
  if (sorted.length === 0) return <span className="text-xs text-fg-subtle">None</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((permission) => (
        <code
          key={permission}
          className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
        >
          {permission}
        </code>
      ))}
      {hidden > 0 ? <span className="text-xs text-fg-subtle">+{hidden} more</span> : null}
    </span>
  );
}
