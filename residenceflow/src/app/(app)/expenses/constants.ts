export const EXPENSE_CATEGORIES = ["MAINTENANCE", "UTILITIES", "CLEANING", "SECURITY", "INSURANCE", "TAX", "MANAGEMENT", "OTHER"] as const;
export const EXPENSE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PAID", "REJECTED"] as const;
/** Legacy attachment naming: older documents carry this prefix instead of an expenseId. */
export const expenseDocPrefix = (id: string) => `expense-${id}-`;
/** Display name of an attachment (strips the legacy prefix when present). */
export const expenseDocLabel = (expenseId: string, name: string) => (name.startsWith(expenseDocPrefix(expenseId)) ? name.slice(expenseDocPrefix(expenseId).length) : name);
/** Backwards-compatible attachment lookup: documents linked by expenseId OR by the legacy name prefix. */
export function expenseDocsWhere(organizationId: string, expenseIds: string[]) {
  return { organizationId, OR: [{ expenseId: { in: expenseIds } }, ...expenseIds.map((id) => ({ category: "OTHER", expenseId: null, name: { startsWith: expenseDocPrefix(id) } }))] };
}
/** True when the document belongs to the expense (by id or legacy prefix). */
export const docBelongsTo = (expenseId: string, doc: { expenseId: string | null; name: string }) => doc.expenseId === expenseId || (!doc.expenseId && doc.name.startsWith(expenseDocPrefix(expenseId)));
