import { API_ENDPOINTS, API_ERRORS, type ApiField, PROBLEM_EXAMPLE } from './reference';

/**
 * OpenAPI 3.1 description generated from the endpoint catalogue. It documents parameters,
 * example payloads and the problem-details error format; request/response bodies are described
 * by example rather than by exhaustive schemas.
 */

const parameter = (field: ApiField, location: 'path' | 'query' | 'header') => ({
  name: field.name,
  in: location,
  required: location === 'path' ? true : field.required,
  description: field.description,
  schema: { type: field.type.startsWith('integer') ? 'integer' : 'string' },
});

export function buildOpenApiDocument(options: { serverUrl: string; appName: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_ENDPOINTS) {
    const operation = {
      operationId: endpoint.id,
      summary: endpoint.summary,
      description: endpoint.description,
      security: [{ apiKey: [] }],
      ...(endpoint.scope ? { 'x-required-scope': endpoint.scope } : {}),
      parameters: [
        ...(endpoint.pathParams ?? []).map((field) => parameter(field, 'path')),
        ...(endpoint.query ?? []).map((field) => parameter(field, 'query')),
        ...(endpoint.headers ?? []).map((field) => parameter(field, 'header')),
      ],
      ...(endpoint.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { type: 'object' }, example: endpoint.body.example },
              },
            },
          }
        : {}),
      responses: {
        [String(endpoint.successStatus)]: {
          description: 'Success',
          content: {
            'application/json': { schema: { type: 'object' }, example: endpoint.responseExample },
          },
        },
        default: {
          description: `Error — one of: ${endpoint.errors.join(', ')}`,
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        },
      },
    };
    (paths[endpoint.path] ??= {})[endpoint.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${options.appName} public API`,
      version: '1.0.0',
      description:
        'Partner API of BI-Rem Lite. Amounts are strings of integer minor units. Mobile-money operators are simulated in the sandbox.',
    },
    servers: [{ url: options.serverUrl }],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key created in the partner portal (brl_…), sent as a Bearer token.',
        },
      },
      schemas: {
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details.',
          required: ['type', 'title', 'status', 'detail', 'code'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            code: { type: 'string', enum: API_ERRORS.map((error) => error.code) },
            instance: { type: 'string' },
            requestId: { type: 'string' },
            errors: {
              type: 'object',
              additionalProperties: { type: 'array', items: { type: 'string' } },
            },
            retryAfterSeconds: { type: 'integer' },
            available: { type: 'string' },
            required: { type: 'string' },
          },
          example: PROBLEM_EXAMPLE,
        },
      },
    },
  };
}
