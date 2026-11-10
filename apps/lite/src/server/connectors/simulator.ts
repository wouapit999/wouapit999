import { sha256Hex } from '../crypto';
import { currencyExponent } from '../money';
import {
  type ConnectorBalance,
  type ConnectorPingResult,
  type ConnectorReverseRequest,
  type ConnectorStatementLine,
  type ConnectorStatusRequest,
  type ConnectorTransferRequest,
  type ConnectorTransferResult,
  ConnectorTimeoutError,
  type ProviderRuntime,
  type ValidateAccountRequest,
  type ValidateAccountResult,
  type WalletConnector,
} from './types';

/**
 * Deterministic sandbox connector. It never talks to a real operator: outcomes depend only on
 * the last four digits of the account number, so demos and tests are reproducible.
 *
 * | Account ends with | validateAccount | transfer            | getStatus (later) |
 * |-------------------|-----------------|---------------------|-------------------|
 * | `0000`            | invalid         | FAILED ACCOUNT_NOT_FOUND | FAILED       |
 * | `0001`            | valid           | FAILED RECIPIENT_LIMIT_EXCEEDED | FAILED |
 * | `0002`            | valid           | FAILED ACCOUNT_BLOCKED | FAILED          |
 * | `0003`            | valid           | PENDING             | SUCCESS           |
 * | `0004`            | valid           | PENDING             | FAILED PROVIDER_REJECTED |
 * | `0005`            | valid           | throws timeout      | SUCCESS           |
 * | `0006`            | valid           | PENDING             | PENDING (until a webhook) |
 * | `0007`            | valid           | SUCCESS             | SUCCESS; `reverse` FAILS |
 * | anything else     | valid           | SUCCESS             | SUCCESS           |
 */

export type SimulatedOutcome =
  | 'SUCCESS'
  | 'ACCOUNT_NOT_FOUND'
  | 'LIMIT_EXCEEDED'
  | 'ACCOUNT_BLOCKED'
  | 'PENDING_THEN_SUCCESS'
  | 'PENDING_THEN_FAILED'
  | 'TIMEOUT_THEN_SUCCESS'
  | 'PENDING_FOREVER'
  | 'SUCCESS_NO_REVERSAL';

const OUTCOME_BY_SUFFIX: Readonly<Record<string, SimulatedOutcome>> = {
  '0000': 'ACCOUNT_NOT_FOUND',
  '0001': 'LIMIT_EXCEEDED',
  '0002': 'ACCOUNT_BLOCKED',
  '0003': 'PENDING_THEN_SUCCESS',
  '0004': 'PENDING_THEN_FAILED',
  '0005': 'TIMEOUT_THEN_SUCCESS',
  '0006': 'PENDING_FOREVER',
  '0007': 'SUCCESS_NO_REVERSAL',
};

/** Test accounts documented in the UI ("sandbox cheat sheet"). */
export const SIMULATOR_SCENARIOS: ReadonlyArray<{
  suffix: string;
  outcome: SimulatedOutcome;
  label: string;
}> = [
  { suffix: '0000', outcome: 'ACCOUNT_NOT_FOUND', label: 'Account does not exist' },
  { suffix: '0001', outcome: 'LIMIT_EXCEEDED', label: 'Fails: recipient limit exceeded' },
  { suffix: '0002', outcome: 'ACCOUNT_BLOCKED', label: 'Fails: account blocked' },
  { suffix: '0003', outcome: 'PENDING_THEN_SUCCESS', label: 'Pending, succeeds on status check' },
  { suffix: '0004', outcome: 'PENDING_THEN_FAILED', label: 'Pending, fails on status check' },
  { suffix: '0005', outcome: 'TIMEOUT_THEN_SUCCESS', label: 'Times out, succeeds on status check' },
  { suffix: '0006', outcome: 'PENDING_FOREVER', label: 'Stays pending until a webhook arrives' },
  { suffix: '0007', outcome: 'SUCCESS_NO_REVERSAL', label: 'Succeeds, but cannot be reversed' },
];

const HOLDER_NAMES = [
  'Simulated Holder Alpha',
  'Simulated Holder Bravo',
  'Simulated Holder Charlie',
  'Simulated Holder Delta',
  'Simulated Holder Echo',
  'Simulated Holder Foxtrot',
];

const digitsOf = (accountNumber: string): string => accountNumber.replace(/\D/g, '');

export function simulatedOutcome(accountNumber: string): SimulatedOutcome {
  return OUTCOME_BY_SUFFIX[digitsOf(accountNumber).slice(-4)] ?? 'SUCCESS';
}

const FAILURES: Partial<Record<SimulatedOutcome, { code: string; reason: string }>> = {
  ACCOUNT_NOT_FOUND: { code: 'ACCOUNT_NOT_FOUND', reason: 'The account does not exist' },
  LIMIT_EXCEEDED: {
    code: 'RECIPIENT_LIMIT_EXCEEDED',
    reason: 'The recipient wallet limit would be exceeded',
  },
  ACCOUNT_BLOCKED: { code: 'ACCOUNT_BLOCKED', reason: 'The recipient account is blocked' },
  PENDING_THEN_FAILED: {
    code: 'PROVIDER_REJECTED',
    reason: 'The operator rejected the transaction',
  },
};

export class SimulatorConnector implements WalletConnector {
  readonly adapter = 'simulator';
  readonly simulated = true;

  constructor(private readonly provider: Pick<ProviderRuntime, 'code' | 'currency' | 'name'>) {}

  /** Stable provider reference derived from our reference — the simulator keeps no state. */
  private providerRef(reference: string): string {
    return `SIM-${this.provider.code.toUpperCase()}-${sha256Hex(`${this.provider.code}:${reference}`).slice(0, 12).toUpperCase()}`;
  }

  validateAccount(request: ValidateAccountRequest): Promise<ValidateAccountResult> {
    const digits = digitsOf(request.accountNumber);
    if (digits.length < 8 || digits.length > 15) {
      return Promise.resolve({ valid: false, reason: 'Account number must be 8–15 digits' });
    }
    if (request.currency !== this.provider.currency) {
      return Promise.resolve({
        valid: false,
        reason: `${this.provider.name} only handles ${this.provider.currency}`,
      });
    }
    if (simulatedOutcome(request.accountNumber) === 'ACCOUNT_NOT_FOUND') {
      return Promise.resolve({ valid: false, reason: 'The account does not exist' });
    }
    const index = Number.parseInt(sha256Hex(digits).slice(0, 6), 16) % HOLDER_NAMES.length;
    return Promise.resolve({ valid: true, accountName: HOLDER_NAMES[index] });
  }

  getBalance(): Promise<ConnectorBalance> {
    // A comfortable, constant sandbox float (10 million major units).
    const scale = 10n ** BigInt(currencyExponent(this.provider.currency));
    return Promise.resolve({ currency: this.provider.currency, available: 10_000_000n * scale });
  }

  transfer(request: ConnectorTransferRequest): Promise<ConnectorTransferResult> {
    const providerRef = this.providerRef(request.reference);
    const outcome = simulatedOutcome(request.accountNumber);
    switch (outcome) {
      case 'SUCCESS':
      case 'SUCCESS_NO_REVERSAL':
        return Promise.resolve({ status: 'SUCCESS', providerRef });
      case 'PENDING_THEN_SUCCESS':
      case 'PENDING_THEN_FAILED':
      case 'PENDING_FOREVER':
        return Promise.resolve({ status: 'PENDING', providerRef });
      case 'TIMEOUT_THEN_SUCCESS':
        return Promise.reject(new ConnectorTimeoutError('Simulated operator timeout'));
      case 'ACCOUNT_NOT_FOUND':
      case 'LIMIT_EXCEEDED':
      case 'ACCOUNT_BLOCKED': {
        const failure = FAILURES[outcome];
        return Promise.resolve({
          status: 'FAILED',
          providerRef,
          failureCode: failure?.code,
          failureReason: failure?.reason,
        });
      }
    }
  }

  getStatus(request: ConnectorStatusRequest): Promise<ConnectorTransferResult> {
    const providerRef = request.providerRef ?? this.providerRef(request.reference);
    const outcome = simulatedOutcome(request.accountNumber);
    switch (outcome) {
      case 'SUCCESS':
      case 'SUCCESS_NO_REVERSAL':
      case 'PENDING_THEN_SUCCESS':
      case 'TIMEOUT_THEN_SUCCESS':
        return Promise.resolve({ status: 'SUCCESS', providerRef });
      case 'PENDING_FOREVER':
        return Promise.resolve({ status: 'PENDING', providerRef });
      case 'ACCOUNT_NOT_FOUND':
      case 'LIMIT_EXCEEDED':
      case 'ACCOUNT_BLOCKED':
      case 'PENDING_THEN_FAILED': {
        const failure = FAILURES[outcome];
        return Promise.resolve({
          status: 'FAILED',
          providerRef,
          failureCode: failure?.code,
          failureReason: failure?.reason,
        });
      }
    }
  }

  reverse(request: ConnectorReverseRequest): Promise<ConnectorTransferResult> {
    const providerRef = `${request.providerRef ?? this.providerRef(request.reference)}-R`;
    if (simulatedOutcome(request.accountNumber) === 'SUCCESS_NO_REVERSAL') {
      return Promise.resolve({
        status: 'FAILED',
        providerRef,
        failureCode: 'REVERSAL_NOT_ALLOWED',
        failureReason: 'The operator refused the reversal (funds already withdrawn)',
      });
    }
    return Promise.resolve({ status: 'SUCCESS', providerRef });
  }

  getStatement(): Promise<ConnectorStatementLine[]> {
    // The simulator keeps no history; BI-Rem's own ledger is the record in sandbox.
    return Promise.resolve([]);
  }

  ping(): Promise<ConnectorPingResult> {
    // Deterministic pseudo-latency per provider so the health history looks alive but stable.
    const latencyMs = 40 + (Number.parseInt(sha256Hex(this.provider.code).slice(0, 4), 16) % 160);
    return Promise.resolve({
      ok: true,
      latencyMs,
      message: 'Simulator reachable (sandbox — no real operator was contacted)',
    });
  }
}
