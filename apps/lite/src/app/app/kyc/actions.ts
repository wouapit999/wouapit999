'use server';

import { createAction } from '@/lib/server-action';
import { AppError } from '@/server/errors';
import {
  type KycDocumentUpload,
  MAX_DOCUMENT_BYTES,
  kycSubmissionSchema,
  sniffDocumentType,
  submitKycCase,
} from '@/server/kyc';

/** Form field → document kind. The order is the order of the form. */
const DOCUMENT_FIELDS = [
  ['idFront', 'ID_FRONT'],
  ['idBack', 'ID_BACK'],
  ['selfie', 'SELFIE'],
  ['proofOfAddress', 'PROOF_OF_ADDRESS'],
] as const;

/**
 * Reads the uploaded files. Size is checked before a file is read into memory; the type is
 * taken from the file's content (magic bytes), never from what the browser claims. The service
 * validates everything again.
 */
async function readDocuments(formData: FormData): Promise<KycDocumentUpload[]> {
  const documents: KycDocumentUpload[] = [];
  for (const [field, kind] of DOCUMENT_FIELDS) {
    const value = formData.get(field);
    if (!(value instanceof File) || value.size === 0) continue;
    if (value.size > MAX_DOCUMENT_BYTES) {
      throw new AppError('VALIDATION', 'Each document must be 1 MB or smaller', {
        fieldErrors: { [field]: ['This file is larger than 1 MB'] },
      });
    }
    const data = new Uint8Array(await value.arrayBuffer());
    const sniffed = sniffDocumentType(data);
    if (!sniffed) {
      throw new AppError('VALIDATION', 'Documents must be JPEG, PNG, WebP or PDF files', {
        fieldErrors: { [field]: ['Use a JPEG, PNG, WebP or PDF file'] },
      });
    }
    documents.push({ kind, fileName: value.name, mimeType: sniffed, data });
  }
  return documents;
}

/**
 * Submits (or re-submits) the customer's identity documents. The vendor check is simulated; its
 * decision is applied by the service, which also notifies the customer and audits the case.
 */
export const submitKycAction = createAction({
  schema: kycSubmissionSchema,
  roles: ['CUSTOMER'],
  handler: async (input, ctx, formData) => {
    const documents = await readDocuments(formData);
    if (!documents.some((document) => document.kind === 'ID_FRONT')) {
      throw new AppError('VALIDATION', 'Upload the front of your ID document', {
        fieldErrors: { idFront: ['Choose a photo or scan of the front of your ID'] },
      });
    }
    if (
      input.targetTier === 'TIER_2' &&
      !documents.some((document) => document.kind === 'PROOF_OF_ADDRESS')
    ) {
      throw new AppError('VALIDATION', 'Tier 2 requires a proof of address', {
        fieldErrors: { proofOfAddress: ['Add a proof of address for Tier 2'] },
      });
    }
    const kycCase = await submitKycCase(ctx, input, documents);
    return { status: kycCase.status };
  },
  revalidate: ['/app/kyc', '/app', '/app/send'],
  redirectTo: (result) => `/app/kyc?result=${result.status}`,
});
