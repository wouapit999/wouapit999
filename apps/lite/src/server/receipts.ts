import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';

import { getEnv } from './env';
import { formatMoney, formatRate, parseRate } from './money';
import type { ActionContext } from './rbac';
import { pdfSafe } from './reports/exports';
import { type TransferDetail, getTransferDetail } from './transfers/queries';

/**
 * Transfer receipts (phase 5): a structured model for the HTML print view and a one-page PDF.
 * Access control is inherited from `getTransferDetail` (sender, recipient, partner, staff).
 */

export interface ReceiptLine {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}

export interface ReceiptData {
  readonly appName: string;
  readonly reference: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly typeLabel: string;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly sections: ReadonlyArray<{
    readonly title: string;
    readonly lines: readonly ReceiptLine[];
  }>;
  /** Honest footnotes, e.g. that the payout provider is simulated. */
  readonly notes: readonly string[];
}

const TYPE_LABELS: Record<string, string> = {
  W2W: 'Wallet to wallet',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International transfer',
  TOPUP: 'Wallet top-up',
};

const STATUS_LABELS: Record<string, string> = {
  PROCESSING: 'Processing',
  ON_HOLD: 'Under review',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Not approved',
  REVERSED: 'Reversed',
};

const PURPOSE_LABELS: Record<string, string> = {
  FAMILY_SUPPORT: 'Family support',
  EDUCATION: 'Education',
  MEDICAL: 'Medical',
  GOODS_AND_SERVICES: 'Goods and services',
  SALARY: 'Salary',
  RENT: 'Rent',
  SAVINGS: 'Savings',
  GIFT: 'Gift',
  BUSINESS: 'Business',
  OTHER: 'Other',
};

const stamp = (date: Date): string => `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

/** Builds the receipt model from a transfer the actor may see. */
export function buildReceiptData(detail: TransferDetail): ReceiptData {
  const { transfer, perspective, provider } = detail;
  const crossCurrency = transfer.sourceCurrency !== transfer.targetCurrency;
  const recipientView = perspective === 'RECIPIENT';

  const parties: ReceiptLine[] = [
    { label: 'From', value: transfer.senderName },
    { label: 'To', value: transfer.recipientName },
  ];
  if (!recipientView)
    parties.push({ label: 'Recipient account', value: transfer.recipientAccount });
  if (provider) parties.push({ label: 'Provider', value: provider.name });
  parties.push({ label: 'Route', value: `${transfer.sourceCountry} -> ${transfer.targetCountry}` });

  const amounts: ReceiptLine[] = [];
  if (transfer.type === 'TOPUP') {
    amounts.push({
      label: 'Collected',
      value: formatMoney(transfer.totalDebit, transfer.sourceCurrency),
    });
    amounts.push({ label: 'Fee', value: formatMoney(transfer.feeAmount, transfer.sourceCurrency) });
    amounts.push({
      label: 'Credited to wallet',
      value: formatMoney(transfer.receiveAmount, transfer.targetCurrency),
      emphasis: true,
    });
  } else if (recipientView) {
    amounts.push({
      label: 'Amount received',
      value: formatMoney(transfer.receiveAmount, transfer.targetCurrency),
      emphasis: true,
    });
  } else {
    amounts.push({
      label: 'Amount sent',
      value: formatMoney(transfer.sendAmount, transfer.sourceCurrency),
    });
    amounts.push({ label: 'Fee', value: formatMoney(transfer.feeAmount, transfer.sourceCurrency) });
    amounts.push({
      label: 'Total paid',
      value: formatMoney(transfer.totalDebit, transfer.sourceCurrency),
      emphasis: true,
    });
    if (crossCurrency) {
      amounts.push({
        label: 'Exchange rate',
        value: `1 ${transfer.sourceCurrency} = ${formatRate(parseRate(transfer.customerRate), 4)} ${transfer.targetCurrency}`,
      });
    }
    amounts.push({
      label: 'Recipient gets',
      value: formatMoney(transfer.receiveAmount, transfer.targetCurrency),
      emphasis: true,
    });
  }

  const details: ReceiptLine[] = [
    { label: 'Reference', value: transfer.reference },
    { label: 'Type', value: TYPE_LABELS[transfer.type] ?? transfer.type },
    { label: 'Status', value: STATUS_LABELS[transfer.status] ?? transfer.status },
    { label: 'Created', value: stamp(transfer.createdAt) },
  ];
  if (transfer.completedAt)
    details.push({ label: 'Completed', value: stamp(transfer.completedAt) });
  if (transfer.providerRef && !recipientView)
    details.push({ label: 'Provider reference', value: transfer.providerRef });
  if (transfer.purpose)
    details.push({ label: 'Purpose', value: PURPOSE_LABELS[transfer.purpose] ?? transfer.purpose });
  if (transfer.note && !recipientView) details.push({ label: 'Note', value: transfer.note });

  const notes: string[] = [];
  if (provider?.simulated) {
    notes.push(
      `${provider.name} runs in sandbox mode: the mobile-money leg of this transaction was simulated.`,
    );
  }
  if (transfer.status !== 'COMPLETED') {
    notes.push('This document is not proof of payment: the transfer is not completed.');
  }
  notes.push('BI-Rem Lite is a demonstration platform. No real funds were moved.');

  return {
    appName: getEnv().appName,
    reference: transfer.reference,
    status: transfer.status,
    statusLabel: STATUS_LABELS[transfer.status] ?? transfer.status,
    typeLabel: TYPE_LABELS[transfer.type] ?? transfer.type,
    createdAt: transfer.createdAt,
    completedAt: transfer.completedAt,
    sections: [
      { title: 'Transaction', lines: details },
      { title: 'Parties', lines: parties },
      { title: 'Amounts', lines: amounts },
    ],
    notes,
  };
}

/** Receipt model for a transfer (HTML print view). NOT_FOUND unless the actor may see it. */
export async function getReceipt(
  ctx: ActionContext,
  transferIdOrReference: string,
): Promise<ReceiptData> {
  return buildReceiptData(await getTransferDetail(ctx, transferIdOrReference));
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = pdfSafe(text).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === '') current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Renders a receipt as a one-page A5 PDF. */
export async function renderReceiptPdf(receipt: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${receipt.appName} receipt ${receipt.reference}`));
  pdf.setCreator(pdfSafe(receipt.appName));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 419.53;
  const height = 595.28;
  const margin = 32;
  const page = pdf.addPage([width, height]);
  const brand = rgb(0.043, 0.431, 0.31);
  const gold = rgb(0.949, 0.718, 0.02);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.39, 0.45, 0.55);
  const rule = rgb(0.89, 0.91, 0.94);

  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: brand });
  page.drawRectangle({ x: 0, y: height - 73, width, height: 3, color: gold });
  page.drawText(pdfSafe(receipt.appName), {
    x: margin,
    y: height - 38,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('Transfer receipt', {
    x: margin,
    y: height - 56,
    size: 10,
    font: regular,
    color: rgb(1, 1, 1),
  });
  const status = pdfSafe(receipt.statusLabel.toUpperCase());
  page.drawText(status, {
    x: width - margin - bold.widthOfTextAtSize(status, 10),
    y: height - 38,
    size: 10,
    font: bold,
    color: gold,
  });
  const reference = pdfSafe(receipt.reference);
  page.drawText(reference, {
    x: width - margin - regular.widthOfTextAtSize(reference, 9),
    y: height - 56,
    size: 9,
    font: regular,
    color: rgb(1, 1, 1),
  });

  let y = height - 96;
  for (const section of receipt.sections) {
    page.drawText(pdfSafe(section.title.toUpperCase()), {
      x: margin,
      y,
      size: 8,
      font: bold,
      color: brand,
    });
    y -= 6;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.7,
      color: rule,
    });
    y -= 14;
    for (const line of section.lines) {
      const font = line.emphasis ? bold : regular;
      const size = line.emphasis ? 10.5 : 9.5;
      page.drawText(pdfSafe(line.label), { x: margin, y, size: 9, font: regular, color: muted });
      const valueLines = wrap(font, line.value, size, width - margin * 2 - 120);
      for (const valueLine of valueLines) {
        page.drawText(valueLine, {
          x: width - margin - font.widthOfTextAtSize(valueLine, size),
          y,
          size,
          font,
          color: ink,
        });
        y -= 14;
      }
    }
    y -= 8;
  }

  y -= 4;
  for (const note of receipt.notes) {
    for (const noteLine of wrap(regular, note, 7.5, width - margin * 2)) {
      page.drawText(noteLine, { x: margin, y, size: 7.5, font: regular, color: muted });
      y -= 10;
    }
    y -= 2;
  }
  page.drawText(pdfSafe(`Generated ${stamp(new Date())}`), {
    x: margin,
    y: 20,
    size: 7,
    font: regular,
    color: muted,
  });
  return pdf.save();
}

/** PDF receipt for a transfer. NOT_FOUND unless the actor may see it. */
export async function getReceiptPdf(
  ctx: ActionContext,
  transferIdOrReference: string,
): Promise<{ data: Uint8Array; fileName: string }> {
  const receipt = await getReceipt(ctx, transferIdOrReference);
  return {
    data: await renderReceiptPdf(receipt),
    fileName: `bi-rem-receipt-${receipt.reference}.pdf`,
  };
}
