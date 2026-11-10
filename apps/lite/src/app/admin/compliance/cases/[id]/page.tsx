import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ActionButton } from '@/components/admin/action-button';
import { type SearchParams, flattenParams, usd } from '@/components/admin/helpers';
import { Notice } from '@/components/admin/notice';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmSubmitButton,
  DescriptionList,
  FormMessage,
  Input,
  Money,
  PageHeader,
  StatusBadge,
  SubmitButton,
  Textarea,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { getCase } from '@/server/aml';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import {
  addCaseNoteAction,
  assignCaseToMeAction,
  createSarDraftAction,
  decideCaseAction,
  fileSarAction,
  updateSarDraftAction,
} from '../../actions';

export const metadata: Metadata = { title: 'Compliance case' };

const statusLabel = (status: string): string | undefined =>
  status === 'ON_HOLD' ? 'On hold' : status === 'REJECTED' ? 'Rejected' : undefined;

/** One compliance case: subject, held transfer, alerts, notes, decision and SAR workflow. */
export default async function ComplianceCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await requirePermission('aml:read');
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  const { notice } = flattenParams(await searchParams);
  if (!z.uuid().safeParse(id).success) notFound();
  const amlCase = await getCase(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const canWrite = roleHasPermission(user.role, 'aml:write');
  const canSar = roleHasPermission(user.role, 'sar:write');
  const open = amlCase.status === 'OPEN' || amlCase.status === 'UNDER_REVIEW';
  const { transfer, subject } = amlCase;
  const held = transfer?.status === 'ON_HOLD';
  const draft = amlCase.sars.find((sar) => sar.status === 'DRAFT');

  return (
    <>
      <PageHeader
        back={{ href: '/admin/compliance?tab=cases', label: 'Cases' }}
        title={`Case ${amlCase.reference}`}
        description={amlCase.summary}
        actions={
          <>
            <StatusBadge
              status={amlCase.priority}
              label={`${humanize(amlCase.priority)} priority`}
            />
            <StatusBadge status={amlCase.status} label={statusLabel(amlCase.status)} />
          </>
        }
      />

      <Notice code={notice} />
      {amlCase.resolution ? (
        <Alert
          tone={amlCase.status === 'REJECTED' ? 'danger' : 'success'}
          title={`${amlCase.status === 'REJECTED' ? 'Rejected' : humanize(amlCase.status)} ${formatDateTime(amlCase.closedAt)}`}
          className="mb-5"
        >
          {amlCase.resolution}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {transfer ? (
            <Card>
              <CardHeader
                title="Transfer under review"
                action={
                  <Link
                    href={`/admin/transfers/${transfer.id}`}
                    className="text-sm font-medium text-accent underline"
                  >
                    Open transfer
                  </Link>
                }
              />
              <CardBody>
                <DescriptionList
                  items={[
                    {
                      label: 'Reference',
                      value: <span className="tabular">{transfer.reference}</span>,
                    },
                    {
                      label: 'Status',
                      value: (
                        <StatusBadge
                          status={transfer.status}
                          label={statusLabel(transfer.status)}
                        />
                      ),
                    },
                    { label: 'Sender', value: transfer.senderName },
                    {
                      label: 'Recipient',
                      value: `${transfer.recipientName} · ${transfer.recipientAccount}`,
                    },
                    {
                      label: 'Corridor',
                      value: `${transfer.sourceCountry} → ${transfer.targetCountry} (${humanize(transfer.deliveryMethod)})`,
                    },
                    {
                      label: 'Amount',
                      value: (
                        <>
                          <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />{' '}
                          · {usd(transfer.sendAmountUsd)}
                        </>
                      ),
                    },
                    {
                      label: 'Reserved',
                      value: held ? (
                        <>
                          <Money amount={transfer.totalDebit} currency={transfer.sourceCurrency} />{' '}
                          in the suspense account
                        </>
                      ) : (
                        'Nothing reserved'
                      ),
                    },
                    {
                      label: 'Purpose',
                      value: transfer.purpose ? humanize(transfer.purpose) : '—',
                    },
                    {
                      label: 'Source of funds',
                      value: transfer.sourceOfFunds ? humanize(transfer.sourceOfFunds) : '—',
                    },
                    { label: 'AML score', value: transfer.amlScore },
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Alerts" description="What the rule engine found" />
            <CardBody>
              {amlCase.alerts.length === 0 ? (
                <p className="text-sm text-fg-muted">No alert is attached to this case.</p>
              ) : (
                <ul className="space-y-3">
                  {amlCase.alerts.map((alert) => (
                    <li key={alert.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="text-fg">
                          <code className="text-xs">{alert.ruleCode}</code> {alert.message}
                        </p>
                        <p className="text-xs text-fg-muted">
                          {humanize(alert.ruleType)} · {humanize(alert.action)} · score +
                          {alert.score} · {formatDateTime(alert.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <StatusBadge status={alert.severity} />
                        <StatusBadge status={alert.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Investigation notes" />
            <CardBody className="space-y-4">
              {amlCase.notes.length === 0 ? (
                <p className="text-sm text-fg-muted">No note yet.</p>
              ) : (
                <ol className="space-y-3">
                  {amlCase.notes.map((note) => (
                    <li key={note.id} className="border-l-2 border-border pl-4">
                      <p className="text-xs text-fg-subtle">
                        {note.authorName} · {formatDateTime(note.createdAt)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-fg">{note.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              {canWrite ? (
                <ActionForm
                  action={addCaseNoteAction}
                  className="space-y-3 border-t border-border pt-4"
                >
                  <input type="hidden" name="caseId" value={amlCase.id} />
                  <Textarea name="body" label="Add a note" rows={3} required minLength={3} />
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Add note
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Suspicious activity report"
              description="Draft the narrative, then record the filing with the authority's reference. Nothing is transmitted to a regulator from BI-Rem Lite."
            />
            <CardBody className="space-y-5">
              {amlCase.sars
                .filter((sar) => sar.status === 'FILED')
                .map((sar) => (
                  <div
                    key={sar.id}
                    className="rounded-lg border border-border p-4"
                    data-sar="filed"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge status="FILED" />
                      <span className="tabular font-medium text-fg">{sar.reference}</span>
                      <span className="text-fg-muted">
                        with {sar.regulator} · {formatDateTime(sar.filedAt)}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{sar.narrative}</p>
                  </div>
                ))}
              {draft ? (
                canSar ? (
                  <>
                    <ActionForm action={updateSarDraftAction} className="space-y-3">
                      <input type="hidden" name="sarId" value={draft.id} />
                      <input type="hidden" name="caseId" value={amlCase.id} />
                      <p className="text-sm">
                        <StatusBadge status="DRAFT" />{' '}
                        <span className="text-fg-muted">
                          started {formatDateTime(draft.createdAt)}
                        </span>
                      </p>
                      <Textarea
                        name="narrative"
                        label="Narrative"
                        rows={6}
                        required
                        minLength={20}
                        defaultValue={draft.narrative}
                      />
                      <FormMessage />
                      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                        Save draft
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm
                      action={fileSarAction}
                      className="space-y-3 border-t border-border pt-4"
                    >
                      <input type="hidden" name="sarId" value={draft.id} />
                      <input type="hidden" name="caseId" value={amlCase.id} />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          name="regulator"
                          label="Filed with"
                          hint="E.g. ANIF (Cameroon), UIF (Angola), GIFiM (Mozambique)."
                          required
                          minLength={2}
                          maxLength={120}
                        />
                        <Input
                          name="reference"
                          label="Filing reference"
                          hint="Leave empty to generate an internal reference."
                          maxLength={60}
                        />
                      </div>
                      <FormMessage />
                      <ConfirmSubmitButton
                        size="sm"
                        pendingLabel="Filing…"
                        confirm="Mark this report as filed? A filed report can no longer be edited."
                      >
                        Mark as filed
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </>
                ) : (
                  <div className="rounded-lg border border-border p-4">
                    <StatusBadge status="DRAFT" />
                    <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{draft.narrative}</p>
                  </div>
                )
              ) : canSar ? (
                <ActionForm action={createSarDraftAction} className="space-y-3">
                  <input type="hidden" name="caseId" value={amlCase.id} />
                  <Textarea
                    name="narrative"
                    label="Start a draft"
                    hint="Who, what, when, where and why the activity is suspicious."
                    rows={5}
                    required
                    minLength={20}
                  />
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Save SAR draft
                  </SubmitButton>
                </ActionForm>
              ) : amlCase.sars.length === 0 ? (
                <p className="text-sm text-fg-muted">No report has been drafted.</p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {subject ? (
            <Card>
              <CardHeader
                title="Subject"
                action={
                  <Link
                    href={`/admin/customers/${subject.id}`}
                    className="text-sm font-medium text-accent underline"
                  >
                    Customer 360°
                  </Link>
                }
              />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Name', value: subject.fullName },
                    { label: 'E-mail', value: subject.email },
                    { label: 'Phone', value: subject.phone ?? '—' },
                    { label: 'Country', value: subject.countryCode ?? '—' },
                    {
                      label: 'KYC',
                      value: (
                        <>
                          <StatusBadge status={subject.kycStatus} /> {humanize(subject.kycTier)}
                        </>
                      ),
                    },
                    {
                      label: 'Risk',
                      value: (
                        <>
                          <StatusBadge status={subject.riskLevel} />{' '}
                          <span className="tabular text-xs text-fg-muted">
                            score {subject.riskScore}
                          </span>
                        </>
                      ),
                    },
                    {
                      label: 'Screening',
                      value: (
                        <span className="flex flex-wrap gap-1.5">
                          <Badge tone={subject.sanctionsMatch ? 'danger' : 'neutral'}>
                            Sanctions: {subject.sanctionsMatch ? 'match' : 'clear'}
                          </Badge>
                          <Badge tone={subject.pepMatch ? 'warning' : 'neutral'}>
                            PEP: {subject.pepMatch ? 'match' : 'clear'}
                          </Badge>
                        </span>
                      ),
                    },
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          {canWrite && open ? (
            <Card>
              <CardHeader
                title="Decision"
                description={
                  held
                    ? 'Releasing completes the transfer (or sends it to the provider); rejecting returns the reserved funds to the sender.'
                    : 'No transfer is on hold for this case.'
                }
              />
              <CardBody className="space-y-5">
                {amlCase.assignedToId === user.id ? (
                  <p className="text-sm text-fg-muted">This case is assigned to you.</p>
                ) : (
                  <ActionButton
                    action={assignCaseToMeAction}
                    fields={{ caseId: amlCase.id }}
                    showSuccess
                  >
                    Assign to me
                  </ActionButton>
                )}
                {held ? (
                  <>
                    <ActionForm
                      action={decideCaseAction}
                      className="space-y-3"
                      data-decision="release"
                    >
                      <input type="hidden" name="caseId" value={amlCase.id} />
                      <input type="hidden" name="decision" value="RELEASE" />
                      <Textarea
                        name="note"
                        label="Why the transfer can go ahead"
                        rows={2}
                        required
                        minLength={5}
                      />
                      <FormMessage />
                      <ConfirmSubmitButton
                        size="sm"
                        pendingLabel="Releasing…"
                        confirm={`Release ${transfer.reference}? The held funds will be delivered.`}
                      >
                        Release transfer
                      </ConfirmSubmitButton>
                    </ActionForm>
                    <ActionForm
                      action={decideCaseAction}
                      className="space-y-3 border-t border-border pt-4"
                      data-decision="reject"
                    >
                      <input type="hidden" name="caseId" value={amlCase.id} />
                      <input type="hidden" name="decision" value="REJECT" />
                      <Textarea
                        name="note"
                        label="Why the transfer is rejected"
                        rows={2}
                        required
                        minLength={5}
                      />
                      <FormMessage />
                      <ConfirmSubmitButton
                        size="sm"
                        variant="danger"
                        pendingLabel="Rejecting…"
                        confirm={`Reject ${transfer.reference}? The sender will be refunded.`}
                      >
                        Reject and refund
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </>
                ) : (
                  <ActionForm action={decideCaseAction} className="space-y-3">
                    <input type="hidden" name="caseId" value={amlCase.id} />
                    <input type="hidden" name="decision" value="CLOSE" />
                    <Textarea name="note" label="Conclusion" rows={2} required minLength={5} />
                    <FormMessage />
                    <SubmitButton size="sm" variant="secondary" pendingLabel="Closing…">
                      Close case
                    </SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Case file" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Opened', value: formatDateTime(amlCase.createdAt) },
                  { label: 'Last update', value: formatDateTime(amlCase.updatedAt) },
                  {
                    label: 'Assigned',
                    value: amlCase.assignedToId
                      ? amlCase.assignedToId === user.id
                        ? 'You'
                        : 'Another officer'
                      : 'Unassigned',
                  },
                  { label: 'Closed', value: formatDateTime(amlCase.closedAt) },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
