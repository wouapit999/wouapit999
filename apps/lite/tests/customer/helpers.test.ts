import { describe, expect, it } from 'vitest';

import { transferEffect, usedPercent } from '@/app/app/_lib/display';
import { labelFor, maskAccount, optionsFor, transferKindLabel } from '@/app/app/_lib/labels';
import {
  type RecipientDraft,
  checkPlanMatchesChoice,
  describeOutcome,
  formatCountdown,
  recipientFormSchema,
  recipientPayload,
  recipientTypesFor,
  secondsUntil,
  toRecipientInput,
} from '@/app/app/_lib/send';
import { orderTimeline } from '@/app/app/_lib/timeline';
import { describeUserAgent, groupSecret } from '@/app/app/_lib/user-agent';

const WALLET = '0b0e3c56-3f0a-4c7e-9a51-6a1f4f8f3c11';
const PROVIDER = '7c9f6a52-1d1b-4d5e-8f7a-2b3c4d5e6f70';
const BENEFICIARY = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';

const draft = (patch: Partial<RecipientDraft> = {}): RecipientDraft => ({
  senderWalletId: WALLET,
  scope: 'DOMESTIC',
  targetCountry: '',
  recipientType: 'PERSON',
  identifier: '',
  providerId: '',
  accountNumber: '',
  recipientName: '',
  beneficiaryId: '',
  ...patch,
});

/** What reaches the action's schema: the form post drops empty and missing fields. */
function posted(patch: Partial<RecipientDraft>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recipientPayload(draft(patch))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
}

/** Field names with an error, for a draft posted the way the wizard posts it. */
function errorFields(patch: Partial<RecipientDraft>): string[] {
  const result = recipientFormSchema.safeParse(posted(patch));
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
}

describe('send flow — recipient form', () => {
  it('accepts a phone number or an e-mail for a BI-Rem customer', () => {
    expect(errorFields({ identifier: '+237 677 000 104' })).toEqual([]);
    expect(errorFields({ identifier: 'joao@example.com' })).toEqual([]);
  });

  it('rejects an empty, malformed or code-like identifier for a customer', () => {
    expect(errorFields({ identifier: '' })).toEqual(['identifier']);
    expect(errorFields({ identifier: 'not a phone' })).toEqual(['identifier']);
    expect(errorFields({ identifier: 'M-DEMO01' })).toEqual(['identifier']);
  });

  it('requires the right code shape for merchants and agents', () => {
    expect(errorFields({ recipientType: 'MERCHANT', identifier: 'm-demo01' })).toEqual([]);
    expect(errorFields({ recipientType: 'MERCHANT', identifier: 'A-DEMO01' })).toEqual([
      'identifier',
    ]);
    expect(errorFields({ recipientType: 'AGENT', identifier: 'A-DEMO01' })).toEqual([]);
    expect(errorFields({ recipientType: 'AGENT', identifier: '+237677000104' })).toEqual([
      'identifier',
    ]);
  });

  it('requires provider, number and name for mobile money', () => {
    expect(errorFields({ recipientType: 'MOBILE_MONEY' })).toEqual([
      'accountNumber',
      'providerId',
      'recipientName',
    ]);
    expect(
      errorFields({
        recipientType: 'MOBILE_MONEY',
        providerId: PROVIDER,
        accountNumber: '+237 670 12 34 56',
        recipientName: 'Awa Demo',
      }),
    ).toEqual([]);
  });

  it('requires a destination country for international transfers, except to a beneficiary', () => {
    expect(errorFields({ scope: 'INTERNATIONAL', identifier: 'joao@example.com' })).toEqual([
      'targetCountry',
    ]);
    expect(
      errorFields({ scope: 'INTERNATIONAL', targetCountry: 'ao', identifier: 'joao@example.com' }),
    ).toEqual([]);
    expect(
      errorFields({
        scope: 'INTERNATIONAL',
        recipientType: 'BENEFICIARY',
        beneficiaryId: BENEFICIARY,
      }),
    ).toEqual([]);
  });

  it('keeps merchant and agent payments domestic', () => {
    expect(
      errorFields({
        scope: 'INTERNATIONAL',
        targetCountry: 'AO',
        recipientType: 'MERCHANT',
        identifier: 'M-DEMO01',
      }),
    ).toContain('recipientType');
    expect(recipientTypesFor('INTERNATIONAL', false)).toEqual(['PERSON', 'MOBILE_MONEY']);
    expect(recipientTypesFor('DOMESTIC', true)).toEqual([
      'PERSON',
      'MERCHANT',
      'AGENT',
      'MOBILE_MONEY',
      'BENEFICIARY',
    ]);
  });

  it('rejects a wallet id that is not a uuid', () => {
    expect(errorFields({ senderWalletId: 'mine', identifier: 'joao@example.com' })).toEqual([
      'senderWalletId',
    ]);
  });
});

describe('send flow — payload and engine input', () => {
  it('posts only the fields of the chosen recipient type', () => {
    const stale = draft({
      recipientType: 'BENEFICIARY',
      beneficiaryId: BENEFICIARY,
      identifier: 'left-over@example.com',
      providerId: PROVIDER,
      accountNumber: '+237670123456',
      targetCountry: 'AO',
    });
    expect(recipientPayload(stale)).toEqual({
      senderWalletId: WALLET,
      scope: 'DOMESTIC',
      recipientType: 'BENEFICIARY',
      beneficiaryId: BENEFICIARY,
    });
  });

  it('drops the destination country of a domestic transfer and upper-cases codes', () => {
    expect(recipientPayload(draft({ targetCountry: 'AO', identifier: ' a@b.co ' }))).toMatchObject({
      targetCountry: undefined,
      identifier: 'a@b.co',
    });
    expect(
      recipientPayload(draft({ recipientType: 'MERCHANT', identifier: ' m-demo01 ' })).identifier,
    ).toBe('M-DEMO01');
  });

  it('maps every recipient type to the engine input', () => {
    const parse = (patch: Partial<RecipientDraft>) =>
      toRecipientInput(recipientFormSchema.parse(posted(patch)));
    expect(parse({ identifier: 'joao@example.com' })).toEqual({
      kind: 'WALLET',
      identifier: 'joao@example.com',
    });
    expect(parse({ recipientType: 'AGENT', identifier: 'a-demo01' })).toEqual({
      kind: 'WALLET',
      identifier: 'A-DEMO01',
    });
    expect(
      parse({
        recipientType: 'MOBILE_MONEY',
        providerId: PROVIDER,
        accountNumber: '+237670123456',
        recipientName: 'Awa Demo',
      }),
    ).toEqual({
      kind: 'MOBILE_MONEY',
      providerId: PROVIDER,
      accountNumber: '+237670123456',
      name: 'Awa Demo',
    });
    expect(parse({ recipientType: 'BENEFICIARY', beneficiaryId: BENEFICIARY })).toEqual({
      kind: 'BENEFICIARY',
      beneficiaryId: BENEFICIARY,
    });
  });
});

describe('send flow — the plan must match what the customer chose', () => {
  const angola = {
    international: true,
    recipientCountry: 'AO',
    recipientCountryName: 'Angola',
    recipientWalletType: 'CUSTOMER',
  } as const;
  const local = { ...angola, international: false, recipientCountry: 'CM' } as const;

  it('accepts a plan that matches', () => {
    expect(
      checkPlanMatchesChoice({ scope: 'DOMESTIC', recipientType: 'PERSON' }, local),
    ).toBeNull();
    expect(
      checkPlanMatchesChoice(
        { scope: 'INTERNATIONAL', targetCountry: 'AO', recipientType: 'PERSON' },
        angola,
      ),
    ).toBeNull();
  });

  it('refuses a "domestic" transfer that would in fact go abroad', () => {
    const mismatch = checkPlanMatchesChoice({ scope: 'DOMESTIC', recipientType: 'PERSON' }, angola);
    expect(mismatch?.field).toBe('scope');
    expect(mismatch?.message).toContain('Angola');
  });

  it('refuses an "international" transfer to the own country or to another country', () => {
    expect(
      checkPlanMatchesChoice(
        { scope: 'INTERNATIONAL', targetCountry: 'AO', recipientType: 'PERSON' },
        local,
      )?.field,
    ).toBe('scope');
    expect(
      checkPlanMatchesChoice(
        { scope: 'INTERNATIONAL', targetCountry: 'MZ', recipientType: 'PERSON' },
        angola,
      )?.field,
    ).toBe('targetCountry');
  });

  it('refuses a code that is not the kind of account the customer meant to pay', () => {
    expect(
      checkPlanMatchesChoice(
        { scope: 'DOMESTIC', recipientType: 'MERCHANT' },
        { ...local, recipientWalletType: 'AGENT' },
      )?.field,
    ).toBe('identifier');
    expect(
      checkPlanMatchesChoice(
        { scope: 'DOMESTIC', recipientType: 'AGENT' },
        { ...local, recipientWalletType: 'AGENT' },
      ),
    ).toBeNull();
    expect(
      checkPlanMatchesChoice(
        { scope: 'DOMESTIC', recipientType: 'PERSON' },
        { ...local, recipientWalletType: 'MERCHANT' },
      )?.field,
    ).toBe('identifier');
  });

  it('takes a saved beneficiary as it is, wherever it is', () => {
    expect(
      checkPlanMatchesChoice(
        { scope: 'DOMESTIC', recipientType: 'BENEFICIARY' },
        {
          ...angola,
          recipientWalletType: null,
        },
      ),
    ).toBeNull();
  });
});

describe('quote countdown', () => {
  it('formats seconds as mm:ss and never goes negative', () => {
    expect(formatCountdown(899)).toBe('14:59');
    expect(formatCountdown(60)).toBe('01:00');
    expect(formatCountdown(9.9)).toBe('00:09');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('measures the time left against a given clock', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    expect(secondsUntil('2026-11-10T10:15:00.000Z', now)).toBe(900);
    expect(secondsUntil(new Date('2026-11-10T10:00:00.900Z'), now)).toBe(0);
    expect(secondsUntil('2026-11-10T09:59:00.000Z', now)).toBe(0);
    expect(secondsUntil('not a date', now)).toBe(0);
  });
});

describe('transfer outcome wording', () => {
  const base = { type: 'W2W', deliveryMethod: 'WALLET' };

  it('explains a hold without asking the customer to act', () => {
    const outcome = describeOutcome({ ...base, status: 'ON_HOLD' });
    expect(outcome.tone).toBe('warning');
    expect(outcome.title).toBe('Transfer under review');
    expect(outcome.body).toContain('reserved');
    expect(outcome.fundsReturned).toBe(false);
  });

  it('says the money is back when a payout fails, with the operator reason', () => {
    const outcome = describeOutcome({
      ...base,
      deliveryMethod: 'MOBILE_MONEY',
      status: 'FAILED',
      failureReason: 'The recipient account is blocked',
    });
    expect(outcome.tone).toBe('danger');
    expect(outcome.body).toContain('The recipient account is blocked');
    expect(outcome.body).toContain('back in your wallet');
    expect(outcome.fundsReturned).toBe(true);
  });

  it('never claims a failed top-up charged anything', () => {
    const outcome = describeOutcome({
      type: 'TOPUP',
      deliveryMethod: 'MOBILE_MONEY',
      status: 'FAILED',
    });
    expect(outcome.title).toBe('Top-up failed');
    expect(outcome.body).toContain('not credited');
  });

  it('distinguishes sender and recipient', () => {
    expect(describeOutcome({ ...base, status: 'COMPLETED', perspective: 'RECIPIENT' }).title).toBe(
      'Money received',
    );
    expect(
      describeOutcome({ ...base, status: 'REVERSED', perspective: 'RECIPIENT' }).fundsReturned,
    ).toBe(false);
    expect(
      describeOutcome({ ...base, status: 'REVERSED', perspective: 'SENDER' }).fundsReturned,
    ).toBe(true);
  });

  it('covers every status the engine can produce', () => {
    for (const status of ['PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED']) {
      expect(describeOutcome({ ...base, status }).title).not.toBe('Transfer status');
    }
    expect(describeOutcome({ ...base, status: 'SOMETHING_NEW' }).tone).toBe('info');
  });
});

describe('display helpers', () => {
  it('signs list amounts by what really happened to the wallet', () => {
    expect(transferEffect('sent', 'COMPLETED')).toBe('debit');
    expect(transferEffect('sent', 'ON_HOLD')).toBe('debit');
    expect(transferEffect('sent', 'PROCESSING')).toBe('debit');
    expect(transferEffect('sent', 'FAILED')).toBe('none');
    expect(transferEffect('sent', 'REJECTED')).toBe('none');
    expect(transferEffect('sent', 'REVERSED')).toBe('none');
    expect(transferEffect('received', 'COMPLETED')).toBe('credit');
    expect(transferEffect('received', 'FAILED')).toBe('none');
    expect(transferEffect('received', 'PROCESSING')).toBe('none');
  });

  it('computes the used share of a limit with bigint arithmetic', () => {
    expect(usedPercent(100_000n, 100_000n)).toBe(0);
    expect(usedPercent(100_000n, 25_000n)).toBe(75);
    expect(usedPercent(100_000n, 0n)).toBe(100);
    expect(usedPercent(100_000n, -5n)).toBe(100);
    expect(usedPercent(100_000n, 250_000n)).toBe(0);
    expect(usedPercent(0n, 0n)).toBe(0);
  });

  it('names a domestic mobile-money payout for what it is', () => {
    expect(transferKindLabel('W2W', 'WALLET')).toBe('Wallet to wallet');
    expect(transferKindLabel('W2W', 'MOBILE_MONEY')).toBe('Mobile-money payout');
    expect(transferKindLabel('INTERNATIONAL', 'MOBILE_MONEY')).toBe(
      'International mobile-money payout',
    );
    expect(transferKindLabel('TOPUP', 'MOBILE_MONEY')).toBe('Wallet top-up');
    expect(transferKindLabel('BRAND_NEW')).toBe('Brand new');
  });

  it('masks accounts and builds select options', () => {
    expect(maskAccount('+237699000101')).toBe('+237 ••• 0101');
    expect(maskAccount('amina@example.com')).toBe('am•••@example.com');
    expect(maskAccount('12345')).toBe('12345');
    expect(optionsFor(['SALARY', 'NEW_ONE'], { SALARY: 'Salary' })).toEqual([
      { value: 'SALARY', label: 'Salary' },
      { value: 'NEW_ONE', label: 'New one' },
    ]);
    expect(labelFor({}, 'ON_HOLD')).toBe('On hold');
  });

  it('orders same-instant timeline events by the transfer life cycle', () => {
    const at = new Date('2026-11-10T10:00:00.000Z');
    const later = new Date('2026-11-10T10:00:05.000Z');
    const ordered = orderTimeline([
      { type: 'COMPLETED', createdAt: at },
      { type: 'REFUNDED', createdAt: later },
      { type: 'FUNDS_RESERVED', createdAt: at },
      { type: 'CREATED', createdAt: at },
      { type: 'FAILED', createdAt: later },
    ]);
    expect(ordered.map((event) => event.type)).toEqual([
      'CREATED',
      'FUNDS_RESERVED',
      'COMPLETED',
      'FAILED',
      'REFUNDED',
    ]);
  });

  it('describes a device from its user agent', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toBe('Firefox on Linux');
    expect(describeUserAgent(null)).toBe('Unknown device');
    expect(describeUserAgent('something-else/1.0')).toBe('Unknown device');
  });

  it('groups a TOTP secret for manual entry', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDE')).toBe('ABCD E');
  });
});
