export type TemplateVariables = Record<string, string | number | boolean | null | undefined>;

const PLACEHOLDER = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

export interface RenderOptions {
  /** `empty` substitutes missing variables with '' (default); `throw` rejects the render. */
  onMissing?: 'empty' | 'throw';
  /** HTML-escape substituted values (for HTML e-mail bodies). */
  escapeHtml?: boolean;
}

export class TemplateRenderError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing template variables: ${missing.join(', ')}`);
    this.name = 'TemplateRenderError';
  }
}

/** Returns the distinct placeholder names used in a template, in order of appearance. */
export function extractPlaceholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Handlebars-light interpolation: replaces `{{name}}` with the stringified variable. Only
 * simple identifiers are supported on purpose: templates are authored by operators and must
 * never gain the ability to execute helpers or access nested objects.
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  options: RenderOptions = {},
): string {
  const missing: string[] = [];
  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) {
      missing.push(name);
      return '';
    }
    const text = typeof value === 'string' ? value : String(value);
    return options.escapeHtml ? escapeHtml(text) : text;
  });
  if (missing.length && options.onMissing === 'throw') {
    throw new TemplateRenderError([...new Set(missing)]);
  }
  return rendered;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
