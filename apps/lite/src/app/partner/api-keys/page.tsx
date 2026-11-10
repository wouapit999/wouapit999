import type { Metadata } from 'next';
import Link from 'next/link';

import { PartnerActionButton } from '@/components/partner/action-button';
import { ApiKeyForm, type ScopeOption } from '@/components/partner/api-key-form';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/format';
import { API_KEY_SCOPES, listApiKeys } from '@/server/partners';

import { getPartnerPage } from '../_lib/partner';
import { createApiKeyAction, revokeApiKeyAction } from '../actions';

export const metadata: Metadata = { title: 'API keys' };

const SCOPE_DESCRIPTIONS: Readonly<Record<(typeof API_KEY_SCOPES)[number], string>> = {
  'transfers:read': 'List and read your transfers.',
  'transfers:write': 'Send transfers from your wallet and refresh pending payouts.',
  'wallets:read': 'See your wallet balances in GET /api/v1/me.',
  'quotes:write': 'Create quotes that lock a fee and an FX rate for 15 minutes.',
};

const SCOPE_OPTIONS: readonly ScopeOption[] = API_KEY_SCOPES.map((scope) => ({
  value: scope,
  label: scope,
  description: SCOPE_DESCRIPTIONS[scope],
}));

const MAX_ACTIVE_KEYS = 10;

/** API keys of the partner: create (shown once), list by prefix, revoke. */
export default async function PartnerApiKeysPage() {
  const { ctx, partner } = await getPartnerPage();
  const keys = await listApiKeys(ctx);
  const active = keys.filter((key) => !key.revokedAt);
  const isActive = partner.status === 'ACTIVE';
  const atLimit = active.length >= MAX_ACTIVE_KEYS;

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys authenticate your servers against /api/v1. BI-Rem stores only a SHA-256 hash: the full key is displayed once, when you create it."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Create a key" />
          <CardBody>
            {!isActive ? (
              <Alert tone="info" className="mb-4">
                API keys are available once your partner account is active.
              </Alert>
            ) : atLimit ? (
              <Alert tone="warning" className="mb-4">
                You have {MAX_ACTIVE_KEYS} active keys, the maximum. Revoke one to create another.
              </Alert>
            ) : null}
            <ApiKeyForm
              action={createApiKeyAction}
              scopes={SCOPE_OPTIONS}
              disabled={!isActive || atLimit}
            />
          </CardBody>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader
            title="Your keys"
            description={`${active.length} active · ${keys.length - active.length} revoked`}
          />
          {keys.length === 0 ? (
            <EmptyState
              title="No API key yet"
              description={
                <>
                  Create one, then try{' '}
                  <Link href="/partner/docs" className="font-medium text-accent hover:underline">
                    the first request in the API reference
                  </Link>
                  .
                </>
              }
            />
          ) : (
            <Table caption="API keys">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Key</Th>
                  <Th>Scopes</Th>
                  <Th>Last used</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {keys.map((key) => (
                  <Tr key={key.id}>
                    <Td>
                      <span className="font-medium">{key.name}</span>
                      <span className="block text-xs text-fg-subtle">
                        Created {formatDate(key.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <code className="font-mono text-[0.8125rem] whitespace-nowrap">
                        brl_{key.prefix}_…
                      </code>
                    </Td>
                    <Td>
                      <span className="flex max-w-56 flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope}>{scope}</Badge>
                        ))}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-fg-muted">
                      {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Never'}
                    </Td>
                    <Td>
                      {key.revokedAt ? (
                        <Badge tone="neutral">Revoked {formatDate(key.revokedAt)}</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      {key.revokedAt ? null : (
                        <PartnerActionButton
                          action={revokeApiKeyAction}
                          fields={{ id: key.id }}
                          variant="danger"
                          confirm={`Revoke “${key.name}”? Requests using it will fail immediately. This cannot be undone.`}
                          pendingLabel="Revoking…"
                        >
                          Revoke
                          <span className="sr-only"> {key.name}</span>
                        </PartnerActionButton>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card padded className="mt-5">
        <h2 className="text-base font-semibold text-fg">Keeping keys safe</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
          <li>Use keys from your servers only — never in a browser or a mobile app.</li>
          <li>
            One key per system, with the narrowest scopes; rotate by creating a new key, then
            revoking the old one.
          </li>
          <li>
            Each key is limited to 120 requests per minute. Every call is recorded under the key in
            the audit log.
          </li>
          <li>Suspending the partner account disables all of its keys at once.</li>
        </ul>
      </Card>
    </>
  );
}
