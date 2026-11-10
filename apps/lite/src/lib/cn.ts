/** Joins class names, dropping falsy values. Small enough that clsx is not worth a dependency. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
