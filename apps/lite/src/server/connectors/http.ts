import { z } from 'zod';

import { assertSafeOutboundUrl } from '../net-guard';
import {
  type ConnectorBalance,
  ConnectorError,
  type ConnectorPingResult,
  type ConnectorReverseRequest,
  type ConnectorStatementLine,
  type ConnectorStatusRequest,
  ConnectorTimeoutError,
  type ConnectorTransferRequest,
  type ConnectorTransferResult,
  type ConnectorTransferStatus,
  type ProviderRuntime,
  type ValidateAccountRequest,
  type ValidateAccountResult,
  type WalletConnector,
} from './types';

/**
 * Generic, config-driven HTTP connector for production operator endpoints.
 *
 * IMPORTANT: this adapter has NOT been tested against any real operator. It speaks a simple JSON
 * convention (documented below) that an operator gateway or a thin translation proxy must
 * honour; real integrations (MTN MoMo Open API, Orange Money Web Pay, M-Pesa Daraja…) will get
 * dedicated adapters in phase 4 of the roadmap. Everything it needs comes from the `providers`
 * row: `baseUrl`, non-secret `config` and encrypted `credentials` — nothing is in code.
 *
 * config (all optional):
 *   { "paths": { "ping": "/health", "validate": "/accounts/validate", "balance": "/balance",
 *                "transfer": "/transfers", "status": "/transfers/{reference}",
 *                "reverse": "/transfers/{reference}/reverse", "statement": "/statement" },
 *     "auth": { "type": "bearer" | "basic" | "header", "headerName": "X-Api-Key" },
 *     "timeoutMs": 10000 }
 * credentials: bearer → { "token" }, basic → { "username", "password" }, header → { "apiKey" }.
 *
 * Wire format: amounts are minor-unit integer strings; transfer/status/reverse responses are
 * `{ "status": "SUCCESS" | "PENDING" | "FAILED", "providerRef": "...", "failureCode"?,
 * "failureReason"? }` (a few common synonyms are accepted).
 */

const configSchema = z
  .object({
    paths: z
      .object({
        ping: z.string().default('/health'),
        validate: z.string().default('/accounts/validate'),
        balance: z.string().default('/balance'),
        transfer: z.string().default('/transfers'),
        status: z.string().default('/transfers/{reference}'),
        reverse: z.string().default('/transfers/{reference}/reverse'),
        statement: z.string().default('/statement'),
      })
      .prefault({}),
    auth: z
      .object({
        type: z.enum(['bearer', 'basic', 'header', 'none']).default('bearer'),
        headerName: z.string().default('X-Api-Key'),
      })
      .prefault({}),
    timeoutMs: z.number().int().min(500).max(30_000).default(10_000),
  })
  .prefault({});

export type HttpConnectorConfig = z.infer<typeof configSchema>;

const transferResponseSchema = z.object({
  status: z.string(),
  providerRef: z.string().optional(),
  id: z.string().optional(),
  failureCode: z.string().optional(),
  failureReason: z.string().optional(),
  message: z.string().optional(),
});

const STATUS_SYNONYMS: Readonly<Record<string, ConnectorTransferStatus>> = {
  SUCCESS: 'SUCCESS',
  SUCCESSFUL: 'SUCCESS',
  COMPLETED: 'SUCCESS',
  PENDING: 'PENDING',
  PROCESSING: 'PENDING',
  ACCEPTED: 'PENDING',
  FAILED: 'FAILED',
  REJECTED: 'FAILED',
  CANCELLED: 'FAILED',
};

export class HttpConnector implements WalletConnector {
  readonly adapter = 'http';
  readonly simulated = false;
  private readonly config: HttpConnectorConfig;

  constructor(private readonly provider: ProviderRuntime) {
    this.config = configSchema.parse(provider.config);
  }

  private authHeaders(): Record<string, string> {
    const credentials = this.provider.credentials ?? {};
    switch (this.config.auth.type) {
      case 'none':
        return {};
      case 'bearer':
        if (!credentials.token)
          throw new ConnectorError('Provider credentials are missing (token)');
        return { authorization: `Bearer ${credentials.token}` };
      case 'basic': {
        if (!credentials.username || !credentials.password) {
          throw new ConnectorError('Provider credentials are missing (username/password)');
        }
        const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
          'base64',
        );
        return { authorization: `Basic ${encoded}` };
      }
      case 'header':
        if (!credentials.apiKey)
          throw new ConnectorError('Provider credentials are missing (apiKey)');
        return { [this.config.auth.headerName.toLowerCase()]: credentials.apiKey };
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>,
  ): Promise<unknown> {
    if (!this.provider.baseUrl) throw new ConnectorError('Provider base URL is not configured');
    const base = await assertSafeOutboundUrl(this.provider.baseUrl);
    const url = new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...this.authHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (controller.signal.aborted) throw new ConnectorTimeoutError();
      throw new ConnectorError('The provider could not be reached');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 408 || response.status === 504) throw new ConnectorTimeoutError();
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ConnectorError(
          `The provider returned a non-JSON response (HTTP ${response.status})`,
          response.status,
        );
      }
    }
    if (!response.ok && response.status >= 500) {
      throw new ConnectorError(`The provider returned HTTP ${response.status}`, response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError('The provider rejected the credentials', response.status);
    }
    return json;
  }

  private toResult(json: unknown, fallbackRef: string): ConnectorTransferResult {
    const parsed = transferResponseSchema.safeParse(json);
    if (!parsed.success) throw new ConnectorError('The provider returned an unexpected response');
    const status = STATUS_SYNONYMS[parsed.data.status.toUpperCase()];
    if (!status)
      throw new ConnectorError(`Unknown provider status "${parsed.data.status.slice(0, 40)}"`);
    return {
      status,
      providerRef: parsed.data.providerRef ?? parsed.data.id ?? fallbackRef,
      failureCode: parsed.data.failureCode,
      failureReason:
        parsed.data.failureReason ?? (status === 'FAILED' ? parsed.data.message : undefined),
    };
  }

  async validateAccount(request: ValidateAccountRequest): Promise<ValidateAccountResult> {
    const json = await this.request('POST', this.config.paths.validate, { ...request });
    const parsed = z
      .object({
        valid: z.boolean(),
        accountName: z.string().optional(),
        reason: z.string().optional(),
      })
      .safeParse(json);
    if (!parsed.success) throw new ConnectorError('The provider returned an unexpected response');
    return parsed.data;
  }

  async getBalance(): Promise<ConnectorBalance> {
    const json = await this.request('GET', this.config.paths.balance);
    const parsed = z
      .object({ currency: z.string().length(3), available: z.string().regex(/^-?\d+$/) })
      .safeParse(json);
    if (!parsed.success) throw new ConnectorError('The provider returned an unexpected response');
    return { currency: parsed.data.currency, available: BigInt(parsed.data.available) };
  }

  async transfer(request: ConnectorTransferRequest): Promise<ConnectorTransferResult> {
    const json = await this.request('POST', this.config.paths.transfer, {
      reference: request.reference,
      direction: request.direction,
      accountNumber: request.accountNumber,
      amount: request.amount.toString(),
      currency: request.currency,
      narration: request.narration,
      callbackUrl: this.provider.callbackUrl ?? undefined,
    });
    return this.toResult(json, request.reference);
  }

  async getStatus(request: ConnectorStatusRequest): Promise<ConnectorTransferResult> {
    const path = this.config.paths.status.replace(
      '{reference}',
      encodeURIComponent(request.reference),
    );
    return this.toResult(await this.request('GET', path), request.providerRef ?? request.reference);
  }

  async reverse(request: ConnectorReverseRequest): Promise<ConnectorTransferResult> {
    const path = this.config.paths.reverse.replace(
      '{reference}',
      encodeURIComponent(request.reference),
    );
    const json = await this.request('POST', path, {
      providerRef: request.providerRef ?? undefined,
      amount: request.amount.toString(),
      currency: request.currency,
      reason: request.reason,
    });
    return this.toResult(json, `${request.providerRef ?? request.reference}-R`);
  }

  async getStatement(range: { from: Date; to: Date }): Promise<ConnectorStatementLine[]> {
    const json = await this.request('GET', this.config.paths.statement, undefined, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    const parsed = z
      .array(
        z.object({
          providerRef: z.string(),
          reference: z.string(),
          direction: z.enum(['PAYOUT', 'COLLECT']),
          amount: z.string().regex(/^\d+$/),
          currency: z.string().length(3),
          status: z.string(),
          at: z.iso.datetime(),
        }),
      )
      .safeParse(json);
    if (!parsed.success) throw new ConnectorError('The provider returned an unexpected response');
    return parsed.data.map((line) => ({
      providerRef: line.providerRef,
      reference: line.reference,
      direction: line.direction,
      amount: BigInt(line.amount),
      currency: line.currency,
      status: STATUS_SYNONYMS[line.status.toUpperCase()] ?? 'PENDING',
      at: new Date(line.at),
    }));
  }

  async ping(): Promise<ConnectorPingResult> {
    const started = Date.now();
    try {
      await this.request('GET', this.config.paths.ping);
      return { ok: true, latencyMs: Date.now() - started, message: 'Provider endpoint reachable' };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : 'Provider endpoint unreachable',
      };
    }
  }
}
