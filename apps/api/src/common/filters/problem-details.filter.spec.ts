import { describe, expect, it } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { ApiException } from '../errors/api-exception.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

const request = {
  url: '/v1/users',
  originalUrl: '/v1/users?page=1',
  headers: { 'x-request-id': 'corr-42' },
} as unknown as Request;

/** What `body-parser` throws: an `http-errors` instance, not a Nest `HttpException`. */
function bodyParserError(type: string, status: number, message: string) {
  return Object.assign(new SyntaxError(message), {
    status,
    statusCode: status,
    expose: true,
    type,
  });
}

describe('ProblemDetailsFilter.toProblem', () => {
  const filter = new ProblemDetailsFilter();

  it('keeps the stable code and field errors of ApiException', () => {
    const problem = filter.toProblem(
      ApiException.badRequest('Request validation failed', [{ path: 'email', message: 'bad' }]),
      request,
    );
    expect(problem).toMatchObject({
      status: 400,
      title: 'Bad Request',
      code: 'VALIDATION_FAILED',
      detail: 'Request validation failed',
      errors: [{ path: 'email', message: 'bad' }],
      correlationId: 'corr-42',
      instance: '/v1/users?page=1',
    });
  });

  it('maps plain Nest exceptions onto the status-derived code', () => {
    expect(filter.toProblem(new NotFoundException('Nope'), request)).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Nope',
    });
  });

  it('turns body-parser failures into 4xx problems without echoing the parser message', () => {
    const malformed = filter.toProblem(
      bodyParserError('entity.parse.failed', 400, 'Unexpected token } in JSON at position 7'),
      request,
    );
    expect(malformed).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'Malformed JSON body',
    });
    expect(JSON.stringify(malformed)).not.toContain('Unexpected token');

    const tooLarge = filter.toProblem(
      bodyParserError('entity.too.large', 413, 'request entity too large'),
      request,
    );
    expect(tooLarge).toMatchObject({ status: 413, detail: 'Request body is too large' });
  });

  it('never leaks internal error messages or stack traces for unexpected errors', () => {
    const problem = filter.toProblem(new Error('connect ECONNREFUSED 10.0.0.5:5432'), request);
    expect(problem).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    });
    expect(JSON.stringify(problem)).not.toContain('ECONNREFUSED');
    expect(problem).not.toHaveProperty('stack');
  });

  it('does not treat arbitrary objects carrying a 5xx status as client errors', () => {
    const problem = filter.toProblem({ status: 502, expose: true, message: 'upstream' }, request);
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('An unexpected error occurred');
  });
});
