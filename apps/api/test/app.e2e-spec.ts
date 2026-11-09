import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

const API_DIR = path.resolve(import.meta.dirname, '..');
const SERVER_SCRIPT = path.join(API_DIR, 'test', 'e2e-server.mjs');
const BOOT_TIMEOUT_MS = 60_000;

interface Server {
  child: ChildProcess;
  baseUrl: string;
}

/**
 * Starts the API (Nest testing module + Prisma stub, see e2e-server.mjs) in a child process and
 * resolves once it prints its port. Builds `dist/` first when it is missing so the suite also
 * works outside the Turborepo pipeline.
 */
async function startServer(): Promise<Server> {
  if (!existsSync(path.join(API_DIR, 'dist', 'main.js'))) {
    execFileSync('pnpm', ['run', 'build'], { cwd: API_DIR, stdio: 'inherit' });
  }
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: API_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`API did not start within ${BOOT_TIMEOUT_MS} ms\n${stderr}`)),
      BOOT_TIMEOUT_MS,
    );
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) {
        clearTimeout(timer);
        resolve((JSON.parse(line) as { port: number }).port);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`API exited with code ${code ?? 'null'} before listening\n${stderr}`));
    });
  });
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: Server | undefined): Promise<void> {
  if (server?.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.child.once('exit', () => resolve()));
  server.child.kill('SIGTERM');
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref())]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

describe('API (e2e, Nest testing module with Prisma stubbed)', () => {
  let server: Server | undefined;
  const api = () => request(server!.baseUrl);

  beforeAll(async () => {
    server = await startServer();
  }, BOOT_TIMEOUT_MS + 90_000);

  afterAll(async () => {
    await stopServer(server);
  });

  it('GET /health/live is public and reports ok', async () => {
    const response = await api().get('/health/live').expect(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /health/ready reports the database outage as a Terminus report', async () => {
    const response = await api().get('/health/ready').expect(503);
    expect(response.body.status).toBe('error');
    expect(response.body.details.database.status).toBe('down');
    expect(response.body.details.redis).toMatchObject({ status: 'up', configured: false });
  });

  it('GET /v1/auth/me without a token is a 401 problem document that echoes x-request-id', async () => {
    const response = await api()
      .get('/v1/auth/me')
      .set('x-request-id', 'e2e-correlation-0001')
      .expect(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['x-request-id']).toBe('e2e-correlation-0001');
    expect(response.body).toMatchObject({
      status: 401,
      title: 'Unauthorized',
      code: 'UNAUTHENTICATED',
      correlationId: 'e2e-correlation-0001',
      instance: '/v1/auth/me',
    });
  });

  it('rejects malformed bearer tokens and invalid API keys', async () => {
    await api().get('/v1/users/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const apiKey = await api().get('/v1/users').set('x-api-key', 'nope').expect(401);
    expect(apiKey.body.code).toBe('UNAUTHENTICATED');
  });

  it('POST /v1/auth/login validates the body with field-level errors', async () => {
    const response = await api()
      .post('/v1/auth/login')
      .send({ email: 'not-an-email', password: '', extra: true })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    const paths = (response.body.errors as Array<{ path: string }>).map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'extra']));
    expect(response.headers['x-ratelimit-limit']).toBe('10');
  });

  it('GET /metrics exposes the Prometheus registry without authentication', async () => {
    const response = await api().get('/metrics').expect(200);
    expect(response.text).toContain('http_request_duration_seconds');
    expect(response.text).toContain('process_cpu_user_seconds_total');
  });

  it('GET /docs-json serves the OpenAPI document with the v1 prefix applied', async () => {
    const response = await api().get('/docs-json').expect(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining(['/v1/auth/login', '/v1/users', '/v1/audit']),
    );
    expect(response.body.components.securitySchemes.bearer).toBeDefined();
  });

  it('unknown routes are problem documents too', async () => {
    const response = await api().get('/v1/does-not-exist').expect(404);
    expect(response.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
