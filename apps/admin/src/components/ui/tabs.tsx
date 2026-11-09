'use client';

import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';

import { cn } from '@/lib/cn';

export interface TabItem<TKey extends string> {
  key: TKey;
  label: ReactNode;
  disabled?: boolean;
}

/** WAI-ARIA tabs with roving focus (arrow keys move, Home/End jump). Controlled only. */
export function Tabs<TKey extends string>({
  items,
  value,
  onChange,
  label,
  children,
}: {
  items: ReadonlyArray<TabItem<TKey>>;
  value: TKey;
  onChange: (key: TKey) => void;
  label: string;
  children: ReactNode;
}) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.key === value);
    if (index === -1 || enabled.length === 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.key);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${target.key}`)}`)
      ?.focus();
  };

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              id={`${baseId}-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                selected
                  ? 'border-accent text-fg'
                  : 'border-transparent text-fg-muted hover:border-border-strong hover:text-fg',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        id={`${baseId}-panel-${value}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${value}`}
        tabIndex={0}
        className="pt-5"
      >
        {children}
      </div>
    </div>
  );
}
