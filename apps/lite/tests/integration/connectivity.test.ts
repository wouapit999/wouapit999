import { describe, expect, it } from 'vitest';

import {
  createProvider,
  getProvider,
  listAvailableProviders,
  listProviderHealthChecks,
  listProviderSecretVersions,
  listProviders,
  rotateWebhookSecret,
  setProviderCredentials,
  setProviderStatus,
  testProviderConnectivity,
  updateProvider,
} from '@/server/connectors/providers';
import {
  createConnector,
  loadProviderRuntime,
  loadWebhookSecrets,
  registerAdapter,
} from '@/server/connectors/registry';
import { SimulatorConnector } from '@/server/connectors/simulator';
import { decryptSecret } from '@/server/crypto';
import { db } from '@/server/db';

import { withTestDatabase } from '../helpers/db';
import { createCustomer, createStaff, providerId } from '../helpers/factories';

withTestDatabase();

const SECRET_VALUES = ['fake_other_vendor_SUPER-secret-token-9f31', 'p@ssw0rd-very-private', 'client-id-123'];

/** Every text/json value in the database, to prove a plaintext is stored nowhere. */
async function dumpDatabase(): Promise<string> {
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'kyc_documents'`;
  let dump = '';
  for (const { table_name: table } of tables) {
    const rows = await db.$queryRawUnsafe<Array<{ line: string }>>(
      `SELECT row_to_json(t)::text AS line FROM "${table}" t`,
    );
    dump += rows.map((row) => row.line).join('\n');
  }
  return dump;
}

describe('provider credentials', () => {
  it('encrypts credentials, round-trips them for the connector and stores no plaintext anywhere', async () => {
    const admin = await createStaff('ADMIN');
    const id = await providerId('mtn-momo-cm');
    const credentials = {
      token: SECRET_VALUES[0]!,
      password: SECRET_VALUES[1]!,
      clientId: SECRET_VALUES[2]!,
    };

    const { version } = await setProviderCredentials(admin.ctx, id, credentials);
    expect(version).toBe(1);

    // Round trip: the runtime handed to the connector has the exact plaintext back.
    const runtime = await loadProviderRuntime(id);
    expect(runtime.credentials).toEqual(credentials);

    // At rest: an AES-GCM envelope, different every time, containing none of the values.
    const stored = await db.providerSecret.findFirstOrThrow({
      where: { providerId: id, kind: 'CREDENTIALS' },
    });
    expect(stored.ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JSON.parse(decryptSecret(stored.ciphertext))).toEqual(credentials);
    const dump = await dumpDatabase();
    for (const value of SECRET_VALUES) expect(dump).not.toContain(value);
    // The dump really covers the tables we care about.
    expect(dump).toContain('provider.credentials.rotate');
    expect(dump).toContain(stored.ciphertext);

    // Nothing readable comes back through the admin API or the audit log.
    const view = await getProvider(admin.ctx, id);
    expect(view).toMatchObject({ hasCredentials: true, credentialsVersion: 1 });
    expect(JSON.stringify(view)).not.toContain(SECRET_VALUES[0]);
    const history = await listProviderSecretVersions(admin.ctx, id);
    expect(history[0]).not.toHaveProperty('ciphertext');
    expect(history[0]?.hint).toBe('fields: clientId, password, token');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'provider.credentials.rotate', resourceId: id },
    });
    expect(JSON.stringify(audit)).not.toContain(SECRET_VALUES[0]);
  });

  it('rotation bumps the version, retires the old secret and the connector sees the new one', async () => {
    const admin = await createStaff('ADMIN');
    const id = await providerId('orange-money-cm');
    await setProviderCredentials(admin.ctx, id, { token: 'first-token-value' });
    const second = await setProviderCredentials(admin.ctx, id, { token: 'second-token-value' });
    expect(second.version).toBe(2);
    expect((await loadProviderRuntime(id)).credentials).toEqual({ token: 'second-token-value' });
    const versions = await db.providerSecret.findMany({
      where: { providerId: id, kind: 'CREDENTIALS' },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((row) => [row.version, row.retiredAt !== null])).toEqual([
      [1, true],
      [2, false],
    ]);
    // Same plaintext twice still yields different ciphertexts (random IV).
    const third = await setProviderCredentials(admin.ctx, id, { token: 'second-token-value' });
    const latest = await db.providerSecret.findFirstOrThrow({
      where: { providerId: id, kind: 'CREDENTIALS', version: third.version },
    });
    expect(latest.ciphertext).not.toBe(versions[1]!.ciphertext);
  });

  it('webhook secrets are shown once and stored encrypted', async () => {
    const admin = await createStaff('ADMIN');
    const id = await providerId('airtel-money-ga');
    const generated = await rotateWebhookSecret(admin.ctx, id);
    expect(generated.generatedSecret).toMatch(/^whsec_/);
    const own = await rotateWebhookSecret(admin.ctx, id, 'operator-provided-secret-value');
    expect(own.generatedSecret).toBeNull();
    expect(await loadWebhookSecrets(id)).toEqual([
      'operator-provided-secret-value',
      generated.generatedSecret,
    ]);
    const dump = await dumpDatabase();
    expect(dump).not.toContain('operator-provided-secret-value');
    expect(dump).not.toContain(generated.generatedSecret!);
    await expect(rotateWebhookSecret(admin.ctx, id, 'short')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('only users with providers:write can touch secrets or configuration', async () => {
    const support = await createStaff('SUPPORT');
    const treasury = await createStaff('TREASURY');
    const customer = await createCustomer();
    const id = await providerId('mtn-momo-cm');
    await expect(setProviderCredentials(support.ctx, id, { token: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(rotateWebhookSecret(treasury.ctx, id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(setProviderStatus(support.ctx, id, 'INACTIVE')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(listProviders(customer.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Support may read the directory, without any secret material.
    const list = await listProviders(support.ctx);
    expect(list.length).toBeGreaterThan(10);
    expect(JSON.stringify(list)).not.toMatch(/ciphertext/i);
  });
});

describe('provider directory and connectivity', () => {
  it('adding a provider is one row; validation protects the configuration', async () => {
    const admin = await createStaff('ADMIN');
    const created = await createProvider(admin.ctx, {
      code: 'Demo-Wallet-CM',
      name: 'Demo Wallet CM',
      operator: 'Demo Wallet',
      countryCode: 'cm',
      currency: 'xaf',
      adapter: 'simulator',
      environment: 'SANDBOX',
    });
    expect(created).toMatchObject({
      code: 'demo-wallet-cm',
      simulated: true,
      hasCredentials: false,
      webhookPath: '/api/webhooks/providers/demo-wallet-cm',
    });
    expect(
      (await listAvailableProviders({ countryCode: 'CM' })).map((provider) => provider.code),
    ).toContain('demo-wallet-cm');

    await expect(
      createProvider(admin.ctx, { ...baseInput('demo-wallet-cm') }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createProvider(admin.ctx, { ...baseInput('http-no-url'), adapter: 'http' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createProvider(admin.ctx, { ...baseInput('prod-sim'), environment: 'PRODUCTION' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createProvider(admin.ctx, { ...baseInput('bad-adapter'), adapter: 'carrier-pigeon' }),
    ).rejects.toThrow();
    await expect(
      createProvider(admin.ctx, {
        ...baseInput('bad-url'),
        adapter: 'http',
        baseUrl: 'ftp://example.com',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createProvider(admin.ctx, {
        ...baseInput('cred-url'),
        adapter: 'http',
        baseUrl: 'https://user:pass@example.com',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const updated = await updateProvider(admin.ctx, created.id, {
      name: 'Demo Wallet Cameroon',
      operator: 'Demo Wallet',
      countryCode: 'CM',
      currency: 'XAF',
      adapter: 'simulator',
      environment: 'SANDBOX',
      status: 'MAINTENANCE',
    });
    expect(updated).toMatchObject({
      name: 'Demo Wallet Cameroon',
      status: 'MAINTENANCE',
      code: 'demo-wallet-cm',
    });
    expect(
      (await listAvailableProviders({ countryCode: 'CM' })).map((provider) => provider.code),
    ).not.toContain('demo-wallet-cm');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'provider.update', resourceId: created.id },
    });
    expect(audit.before).toMatchObject({ status: 'ACTIVE' });
    expect(audit.after).toMatchObject({ status: 'MAINTENANCE' });
  });

  it('records connectivity tests in the health history', async () => {
    const admin = await createStaff('ADMIN');
    const customer = await createCustomer();
    const id = await providerId('unitel-money-ao');
    await expect(testProviderConnectivity(customer.ctx, id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const healthy = await testProviderConnectivity(admin.ctx, id);
    expect(healthy).toMatchObject({ status: 'HEALTHY', simulated: true });

    // A failing adapter is reported as DOWN, never as a thrown error.
    registerAdapter('always-down', (provider) => {
      const connector = new SimulatorConnector(provider);
      connector.ping = () =>
        Promise.resolve({ ok: false, latencyMs: 5, message: 'connection refused' });
      return connector;
    });
    await db.provider.update({ where: { id }, data: { adapter: 'always-down' } });
    const down = await testProviderConnectivity(admin.ctx, id);
    expect(down).toMatchObject({ status: 'DOWN', message: 'connection refused' });
    await db.provider.update({ where: { id }, data: { adapter: 'simulator' } });

    const history = await listProviderHealthChecks(admin.ctx, id);
    expect(history.map((check) => check.status)).toEqual(['DOWN', 'HEALTHY']);
    expect((await getProvider(admin.ctx, id)).healthStatus).toBe('DOWN');
  });

  it('refuses to build a connector for an unknown adapter', async () => {
    const runtime = await loadProviderRuntime(await providerId('mtn-momo-cm'));
    expect(() => createConnector({ ...runtime, adapter: 'nope' })).toThrow(/No connector adapter/);
  });
});

function baseInput(code: string) {
  return {
    code,
    name: `Provider ${code}`,
    operator: 'Operator',
    countryCode: 'CM',
    currency: 'XAF',
    adapter: 'simulator',
    environment: 'SANDBOX' as const,
  };
}
