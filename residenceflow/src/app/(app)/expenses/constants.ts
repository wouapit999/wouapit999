export const EXPENSE_CATEGORIES = ["MAINTENANCE", "UTILITIES", "CLEANING", "SECURITY", "INSURANCE", "TAX", "MANAGEMENT", "OTHER"] as const;
export const EXPENSE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PAID", "REJECTED"] as const;
/** Attachments are stored as documents whose name carries this prefix (Document has no expenseId). */
export const expenseDocPrefix = (id: string) => `expense-${id}-`;
