'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { INPUT_CLASSES } from '@/components/ui/field';
import { cn } from '@/lib/cn';

import { NAV_GROUPS, type NavItem } from './nav';
import { useSession } from './session-provider';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: NavItem['icon'];
  keywords: readonly string[];
  run: () => void;
}

function matches(command: Command, query: string): boolean {
  const haystack = `${command.label} ${command.group} ${command.keywords.join(' ')}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/** Cmd/Ctrl+K palette listing the sections the admin may open. */
export function CommandPalette() {
  const router = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () =>
      NAV_GROUPS.flatMap((group) =>
        group.items
          .filter((item) => session.canAccess(item.section))
          .map((item) => ({
            id: item.href,
            label: item.label,
            group: group.title,
            icon: item.icon,
            keywords: item.keywords ?? [],
            run: () => router.push(item.href),
          })),
      ),
    [router, session],
  );

  const results = useMemo(
    () => commands.filter((command) => matches(command, query)),
    [commands, query],
  );
  const activeIndex = Math.min(cursor, Math.max(results.length - 1, 0));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // Focus after the native dialog has opened.
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  };

  const execute = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        leadingIcon={<Icon name="search" className="h-4 w-4" />}
        className="hidden text-fg-muted md:inline-flex"
        aria-keyshortcuts="Control+K Meta+K"
      >
        Search
        <kbd className="ml-2 rounded border border-border px-1.5 font-mono text-[10px] text-fg-subtle">
          ⌘K
        </kbd>
      </Button>
      <Dialog open={open} onClose={close} title="Go to" size="sm">
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder="Type a section name…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                execute(results[activeIndex]);
              }
            }}
            className={INPUT_CLASSES}
          />
          <ul id={listId} role="listbox" aria-label="Sections" className="max-h-72 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-fg-muted">No matching section.</li>
            ) : (
              results.map((command, index) => (
                <li
                  key={command.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => execute(command)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                    index === activeIndex
                      ? 'bg-accent-soft text-accent-soft-fg'
                      : 'text-fg hover:bg-surface-muted',
                  )}
                >
                  <Icon name={command.icon} className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{command.label}</span>
                  <span className="text-xs text-fg-subtle">{command.group}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
