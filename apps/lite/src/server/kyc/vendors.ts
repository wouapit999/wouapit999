import { sha256Hex } from '../crypto';

/**
 * KYC vendor abstraction (phase 2). The full platform will call Veriff, Sumsub and Smile
 * Identity; Lite ships SIMULATED implementations behind the same interface. They never contact
 * a vendor: the decision is derived deterministically from the ID number so demos and tests are
 * reproducible. Every result carries `simulated: true` and the UI must say so.
 *
 * | ID number                         | Decision |
 * |-----------------------------------|----------|
 * | ends with `0000`                  | REJECT (document failed authenticity checks) |
 * | ends with `9999` or has `REVIEW`  | REVIEW (manual review required) |
 * | missing ID front document         | REVIEW |
 * | anything else                     | APPROVE |
 */

export type KycVendorKey = 'veriff' | 'sumsub' | 'smile_identity';
export type KycVendorDecision = 'APPROVE' | 'REVIEW' | 'REJECT';

export interface KycVerificationRequest {
  readonly caseId: string;
  readonly fullName: string;
  readonly idType: string;
  readonly idNumber: string;
  readonly idCountry: string;
  readonly documents: ReadonlyArray<{
    kind: string;
    sha256: string;
    size: number;
    mimeType: string;
  }>;
}

export interface KycCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface KycVendorResult {
  readonly vendor: KycVendorKey;
  readonly vendorRef: string;
  readonly decision: KycVendorDecision;
  /** 0–100 confidence. */
  readonly score: number;
  readonly checks: readonly KycCheck[];
  readonly simulated: true;
}

export interface KycProvider {
  readonly key: KycVendorKey;
  readonly name: string;
  /** Always true in Lite. */
  readonly simulated: boolean;
  verify(request: KycVerificationRequest): Promise<KycVendorResult>;
}

class SimulatedKycProvider implements KycProvider {
  readonly simulated = true;

  constructor(
    readonly key: KycVendorKey,
    readonly name: string,
    private readonly refPrefix: string,
  ) {}

  verify(request: KycVerificationRequest): Promise<KycVendorResult> {
    const idNumber = request.idNumber.toUpperCase();
    const hasFront = request.documents.some((document) => document.kind === 'ID_FRONT');
    const digest = sha256Hex(`${this.key}:${request.caseId}:${idNumber}`);
    const vendorRef = `${this.refPrefix}-${digest.slice(0, 14).toUpperCase()}`;
    const jitter = Number.parseInt(digest.slice(0, 2), 16) % 10;

    let decision: KycVendorDecision = 'APPROVE';
    let score = 88 + jitter;
    const checks: KycCheck[] = [
      {
        name: 'document_present',
        passed: hasFront,
        detail: hasFront ? 'ID front received' : 'ID front missing',
      },
    ];

    if (idNumber.endsWith('0000')) {
      decision = 'REJECT';
      score = 12 + jitter;
      checks.push({
        name: 'document_authenticity',
        passed: false,
        detail: 'Security features not recognised',
      });
    } else if (idNumber.endsWith('9999') || idNumber.includes('REVIEW') || !hasFront) {
      decision = 'REVIEW';
      score = 55 + jitter;
      checks.push({
        name: 'document_authenticity',
        passed: true,
        detail: 'Document looks genuine',
      });
      checks.push({
        name: 'data_consistency',
        passed: false,
        detail: 'Low-confidence match — manual review advised',
      });
    } else {
      checks.push({
        name: 'document_authenticity',
        passed: true,
        detail: 'Document looks genuine',
      });
      checks.push({
        name: 'data_consistency',
        passed: true,
        detail: 'Name and ID number are consistent',
      });
    }
    return Promise.resolve({
      vendor: this.key,
      vendorRef,
      decision,
      score,
      checks,
      simulated: true,
    });
  }
}

const VENDORS: Readonly<Record<KycVendorKey, KycProvider>> = {
  veriff: new SimulatedKycProvider('veriff', 'Veriff (simulated)', 'VRF'),
  sumsub: new SimulatedKycProvider('sumsub', 'Sumsub (simulated)', 'SMS'),
  smile_identity: new SimulatedKycProvider('smile_identity', 'Smile Identity (simulated)', 'SMILE'),
};

export const KYC_VENDORS: readonly KycProvider[] = Object.values(VENDORS);

export function getKycProvider(key: KycVendorKey): KycProvider {
  return VENDORS[key];
}

/**
 * Routing used by the full platform, mirrored here: passports go to Veriff (global document
 * coverage), Lusophone national IDs to Sumsub, everything else to the configured default
 * (Smile Identity — African ID databases).
 */
export function selectKycVendor(
  idType: string,
  idCountry: string,
  defaultVendor: KycVendorKey = 'smile_identity',
): KycVendorKey {
  if (idType === 'PASSPORT') return 'veriff';
  if (['AO', 'MZ', 'CV', 'ST', 'GW'].includes(idCountry)) return 'sumsub';
  return defaultVendor;
}
