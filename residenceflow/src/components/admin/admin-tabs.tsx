"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Horizontal, scrollable admin sub-navigation (only sections the user may access are passed in). */
export function AdminTabs({ tabs, label }: { tabs: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-700 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = path === tab.href || path.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  active
                    ? "border-[var(--brand)] font-medium text-[var(--brand)]"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
