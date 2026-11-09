// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseJsonBody, rejectCrossSiteRequest } from '@/lib/server/handlers';

const schema = z.object({ allDevices: z.boolean().default(false) });

function post(init: { body?: string; headers?: Record<string, string>; method?: string }) {
  return new Request('https://admin.test/api/auth/logout', {
    method: init.method ?? 'POST',
    ...(init.body !== undefined ? { body: init.body } : {}),
    headers: init.headers ?? {},
  });
}

describe('rejectCrossSiteRequest', () => {
  it('lets GET requests through regardless of headers', () => {
    const request = post({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(rejectCrossSiteRequest(request)).toBeNull();
  });

  it('rejects cross-site mutating requests flagged by Sec-Fetch-Site', async () => {
    const request = post({
      body: '{}',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    });
    const response = rejectCrossSiteRequest(request);
    expect(response?.status).toBe(403);
    expect(response?.headers.get('content-type')).toContain('application/problem+json');
    await expect(response?.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects form-encoded and text/plain bodies (the vectors HTML forms can produce)', () => {
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'text/plain',
      'multipart/form-data; boundary=x',
    ]) {
      const response = rejectCrossSiteRequest(
        post({ body: 'allDevices=true', headers: { 'content-type': contentType } }),
      );
      expect(response?.status, contentType).toBe(415);
    }
  });

  it('accepts JSON (including vendor +json) from same-origin or header-less clients', () => {
    expect(
      rejectCrossSiteRequest(
        post({
          body: '{}',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'sec-fetch-site': 'same-origin',
          },
        }),
      ),
    ).toBeNull();
    expect(
      rejectCrossSiteRequest(
        post({ body: '{}', headers: { 'content-type': 'application/vnd.api+json' } }),
      ),
    ).toBeNull();
  });

  it('accepts a bodyless POST with no content type', () => {
    expect(rejectCrossSiteRequest(post({ headers: { 'content-length': '0' } }))).toBeNull();
  });
});

describe('parseJsonBody', () => {
  it('treats an empty body as an empty object and applies schema defaults', async () => {
    const result = await parseJsonBody(post({}), schema);
    expect(result).toEqual({ ok: true, data: { allDevices: false } });
  });

  it('parses and validates JSON bodies', async () => {
    const result = await parseJsonBody(
      post({
        body: JSON.stringify({ allDevices: true }),
        headers: { 'content-type': 'application/json' },
      }),
      schema,
    );
    expect(result).toEqual({ ok: true, data: { allDevices: true } });
  });

  it('answers 400 with field errors for invalid payloads', async () => {
    const result = await parseJsonBody(
      post({
        body: JSON.stringify({ allDevices: 'yes' }),
        headers: { 'content-type': 'application/json' },
      }),
      schema,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'allDevices' }],
    });
  });

  it('answers 400 for malformed JSON and 415 for non-JSON content types', async () => {
    const malformed = await parseJsonBody(
      post({ body: '{oops', headers: { 'content-type': 'application/json' } }),
      schema,
    );
    expect(!malformed.ok && malformed.response.status).toBe(400);

    const form = await parseJsonBody(
      post({ body: '{"allDevices":true}', headers: { 'content-type': 'text/plain' } }),
      schema,
    );
    expect(!form.ok && form.response.status).toBe(415);
  });
});
