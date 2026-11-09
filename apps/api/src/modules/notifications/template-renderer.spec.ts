import { describe, expect, it } from '@jest/globals';

import { TemplateRenderError, extractPlaceholders, renderTemplate } from './template-renderer.js';

describe('renderTemplate', () => {
  it('interpolates {{variables}} with optional whitespace and repeated use', () => {
    const out = renderTemplate(
      'Hello {{firstName}}, welcome to {{ appName }}. Bye {{firstName}}!',
      {
        firstName: 'Awa',
        appName: 'BI-Rem',
      },
    );
    expect(out).toBe('Hello Awa, welcome to BI-Rem. Bye Awa!');
  });

  it('stringifies numbers and booleans', () => {
    expect(renderTemplate('{{n}} min, ok={{flag}}', { n: 60, flag: true })).toBe('60 min, ok=true');
  });

  it('renders missing variables as empty strings by default and throws when asked', () => {
    expect(renderTemplate('Hi {{missing}}!', {})).toBe('Hi !');
    expect(() => renderTemplate('Hi {{missing}} {{other}}!', {}, { onMissing: 'throw' })).toThrow(
      TemplateRenderError,
    );
  });

  it('escapes HTML when requested and never evaluates helpers or nested paths', () => {
    expect(renderTemplate('<p>{{name}}</p>', { name: '<b>x</b>' }, { escapeHtml: true })).toBe(
      '<p>&lt;b&gt;x&lt;/b&gt;</p>',
    );
    expect(renderTemplate('{{user.name}} {{#if a}}', { user: 'x' })).toBe(
      '{{user.name}} {{#if a}}',
    );
  });

  it('extracts distinct placeholders in order', () => {
    expect(extractPlaceholders('{{b}} {{a}} {{ b }} {{c}}')).toEqual(['b', 'a', 'c']);
  });
});
