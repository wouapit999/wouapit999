/**
 * The wallet connector contract — the single interface every mobile-money operator integration
 * implements (phase 4). Lite ships two adapters: `simulator` (deterministic sandbox) and `http`
 * (generic, config-driven, for real operator endpoints). Adding an operator is one `providers`
 * row; adding a new protocol is one adapter registered in `registry.ts`.
 */

export type ConnectorTransferStatus = 'SUCCESS' | 'PENDING' | 'FAILED';

export interface ValidateAccountRequest {
  readonly accountNumber: string;
  readonly currency: string;
}

export interface ValidateAccountResult {
  readonly valid: boolean;
  /** Account holder name as registered with the operator, when available. */
  readonly accountName?: string;
  readonly reason?: string;
}

export interface ConnectorBalance {
  readonly currency: string;
  /** Minor units. */
  readonly available: bigint;
}

export interface ConnectorTransferRequest {
  /** BI-Rem transfer reference — the idempotency key towards the operator. */
  readonly reference: string;
  /** PAYOUT pushes money to the account; COLLECT pulls a cash-in from it. */
  readonly direction: 'PAYOUT' | 'COLLECT';
  readonly accountNumber: string;
  /** Minor units. */
  readonly amount: bigint;
  readonly currency: string;
  readonly narration?: string;
}

export interface ConnectorTransferResult {
  readonly status: ConnectorTransferStatus;
  readonly providerRef: string;
  readonly failureCode?: string;
  readonly failureReason?: string;
}

export interface ConnectorStatusRequest {
  readonly reference: string;
  readonly providerRef?: string | null;
  readonly accountNumber: string;
}

export interface ConnectorReverseRequest {
  readonly reference: string;
  readonly providerRef?: string | null;
  readonly accountNumber: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly reason: string;
}

export interface ConnectorStatementLine {
  readonly providerRef: string;
  readonly reference: string;
  readonly direction: 'PAYOUT' | 'COLLECT';
  readonly amount: bigint;
  readonly currency: string;
  readonly status: ConnectorTransferStatus;
  readonly at: Date;
}

export interface ConnectorPingResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly message: string;
}

export interface WalletConnector {
  /** Adapter key (`simulator`, `http`). */
  readonly adapter: string;
  /** True for adapters that never talk to a real operator. Shown in the UI. */
  readonly simulated: boolean;
  validateAccount(request: ValidateAccountRequest): Promise<ValidateAccountResult>;
  getBalance(): Promise<ConnectorBalance>;
  transfer(request: ConnectorTransferRequest): Promise<ConnectorTransferResult>;
  getStatus(request: ConnectorStatusRequest): Promise<ConnectorTransferResult>;
  reverse(request: ConnectorReverseRequest): Promise<ConnectorTransferResult>;
  getStatement(range: { from: Date; to: Date }): Promise<ConnectorStatementLine[]>;
  /** Connectivity test used by the admin dashboard. */
  ping(): Promise<ConnectorPingResult>;
}

/** Decrypted runtime configuration handed to an adapter factory. Never logged or returned. */
export interface ProviderRuntime {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly operator: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly adapter: string;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  readonly baseUrl: string | null;
  readonly callbackUrl: string | null;
  readonly config: Record<string, unknown>;
  readonly credentials: Readonly<Record<string, string>> | null;
}

export type ConnectorFactory = (provider: ProviderRuntime) => WalletConnector;

/** The operator did not answer in time — the outcome is unknown and must be polled later. */
export class ConnectorTimeoutError extends Error {
  constructor(message = 'The provider did not respond in time') {
    super(message);
    this.name = 'ConnectorTimeoutError';
  }
}

/** The operator answered with something unusable (5xx, malformed body, auth failure). */
export class ConnectorError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ConnectorError';
    this.status = status;
  }
}
