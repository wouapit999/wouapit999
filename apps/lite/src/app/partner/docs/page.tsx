import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import {
  API_ENDPOINTS,
  API_ERRORS,
  type ApiField,
  PROBLEM_EXAMPLE,
  WEBHOOK_EVENTS,
  WEBHOOK_PAYLOAD_EXAMPLE,
} from '@/app/api/v1/_lib/reference';
import { CodeBlock } from '@/components/partner/code-block';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  SimulatedBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { SIMULATOR_SCENARIOS } from '@/server/connectors/simulator';
import { getEnv } from '@/server/env';

import { getPartnerPage } from '../_lib/partner';
import {
  VERIFY_NODE,
  VERIFY_PYTHON,
  WEBHOOK_HEADERS_SAMPLE,
  curlFor,
  payoutSample,
  pretty,
  quickStart,
  responseFor,
} from './samples';

export const metadata: Metadata = { title: 'API reference' };

/** Origin of this deployment, for copy-pasteable examples. Falls back to a placeholder. */
async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host || !/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host)) return 'https://your-bi-rem-host';
  const forwarded = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const scheme = forwarded === 'http' || (!forwarded && local) ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/** Parameters as a definition list: readable at 390 px without horizontal scrolling. */
function FieldList({ title, fields }: { title: string; fields: readonly ApiField[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      <dl className="mt-1.5 divide-y divide-border rounded-lg border border-border">
        {fields.map((field) => (
          <div
            key={field.name}
            className="px-3 py-2.5 sm:grid sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-4"
          >
            <dt className="min-w-0">
              <code className="break-all font-mono text-[0.8125rem] font-medium text-fg">
                {field.name}
              </code>
              {field.required ? (
                <span className="ml-1.5 text-xs font-medium text-danger">required</span>
              ) : null}
              <span className="block text-xs text-fg-subtle">{field.type}</span>
            </dt>
            <dd className="mt-1 text-sm text-fg-muted sm:mt-0">{field.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SECTIONS = [
  { id: 'basics', label: 'Basics' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'errors', label: 'Errors' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'sandbox', label: 'Sandbox' },
] as const;

/** Reference for the public REST API (/api/v1) and partner webhooks. */
export default async function PartnerDocsPage() {
  await getPartnerPage();
  const origin = await requestOrigin();

  return (
    <>
      <PageHeader
        title="API reference"
        description="REST API for partners: check rates, lock quotes, send transfers and follow them with signed webhooks."
        actions={
          <a
            href="/api/v1/openapi.json"
            className="text-sm font-medium text-accent hover:underline"
          >
            OpenAPI description (JSON)
          </a>
        }
      />

      <nav aria-label="On this page" className="mb-5 flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-full border border-border bg-surface-raised px-3 py-1 text-sm font-medium text-fg-muted hover:border-border-strong hover:text-fg"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        <Card id="basics" className="scroll-mt-28">
          <CardHeader title="Basics" />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-4 text-sm md:grid-cols-2">
              <div>
                <dt className="font-semibold text-fg">Base URL</dt>
                <dd className="mt-1 text-fg-muted">
                  <code className="break-all font-mono text-[0.8125rem] text-fg">
                    {origin}/api/v1
                  </code>
                  <br />
                  HTTPS only in production. JSON in, JSON out (UTF-8).
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Authentication</dt>
                <dd className="mt-1 text-fg-muted">
                  Send your key on every request:{' '}
                  <code className="font-mono text-[0.8125rem] text-fg">
                    Authorization: Bearer brl_…
                  </code>
                  . Create and revoke keys under{' '}
                  <Link
                    href="/partner/api-keys"
                    className="font-medium text-accent hover:underline"
                  >
                    API keys
                  </Link>
                  . A key only ever sees its own partner&apos;s data.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Money</dt>
                <dd className="mt-1 text-fg-muted">
                  Amounts are strings of integer <strong>minor units</strong> with an ISO 4217
                  currency: 1 500 XAF is <code className="font-mono text-fg">&quot;1500&quot;</code>{' '}
                  (XAF has no decimals), 25.50 AOA is{' '}
                  <code className="font-mono text-fg">&quot;2550&quot;</code>. Never floats.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Idempotency</dt>
                <dd className="mt-1 text-fg-muted">
                  <code className="font-mono text-fg">POST /transfers</code> requires an{' '}
                  <code className="font-mono text-fg">Idempotency-Key</code> header. Retrying with
                  the same key returns the original transfer and never debits twice — retry freely
                  after a timeout.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Scopes</dt>
                <dd className="mt-1 text-fg-muted">
                  <code className="font-mono text-fg">transfers:read</code>,{' '}
                  <code className="font-mono text-fg">transfers:write</code>,{' '}
                  <code className="font-mono text-fg">wallets:read</code>,{' '}
                  <code className="font-mono text-fg">quotes:write</code>. A call outside the
                  key&apos;s scopes is answered <code className="font-mono text-fg">403</code>.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg">Rate limit and tracing</dt>
                <dd className="mt-1 text-fg-muted">
                  120 requests per minute per key; beyond that{' '}
                  <code className="font-mono text-fg">429</code> with{' '}
                  <code className="font-mono text-fg">Retry-After</code>. Every response carries{' '}
                  <code className="font-mono text-fg">x-request-id</code> — you may send your own.
                </dd>
              </div>
            </dl>
            <Alert tone="info" className="mt-5" title="This is a sandbox">
              BI-Rem Lite moves real balances inside its own double-entry ledger, but mobile-money
              operators are <strong>simulated</strong>: no payout leaves the platform.
            </Alert>
          </CardBody>
        </Card>

        <Card id="quick-start" className="scroll-mt-28">
          <CardHeader title="Quick start" description="From a new key to a first transfer" />
          <CardBody>
            <CodeBlock code={quickStart(origin)} label="First requests" language="shell" />
          </CardBody>
        </Card>

        <section
          id="endpoints"
          aria-labelledby="endpoints-title"
          className="scroll-mt-28 space-y-5"
        >
          <h2 id="endpoints-title" className="text-lg font-semibold text-fg">
            Endpoints
          </h2>
          <Card>
            <Table caption="Endpoints of the public API">
              <THead>
                <Tr>
                  <Th>Endpoint</Th>
                  <Th>Purpose</Th>
                  <Th>Scope</Th>
                </Tr>
              </THead>
              <TBody>
                {API_ENDPOINTS.map((endpoint) => (
                  <Tr key={endpoint.id}>
                    <Td className="whitespace-nowrap">
                      <a
                        href={`#endpoint-${endpoint.id}`}
                        className="font-mono text-[0.8125rem] font-medium text-accent hover:underline"
                      >
                        {endpoint.method} {endpoint.path}
                      </a>
                    </Td>
                    <Td>{endpoint.summary}</Td>
                    <Td>
                      {endpoint.scope ? (
                        <Badge>{endpoint.scope}</Badge>
                      ) : (
                        <span className="text-xs text-fg-subtle">any key</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>

          {API_ENDPOINTS.map((endpoint) => (
            <Card key={endpoint.id} id={`endpoint-${endpoint.id}`} className="scroll-mt-28">
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={endpoint.method === 'GET' ? 'info' : 'brand'}>
                      {endpoint.method}
                    </Badge>
                    <code className="break-all font-mono text-sm">{endpoint.path}</code>
                  </span>
                }
                description={endpoint.summary}
                action={
                  endpoint.scope ? (
                    <Badge>scope {endpoint.scope}</Badge>
                  ) : (
                    <Badge tone="neutral">any key</Badge>
                  )
                }
              />
              <CardBody className="space-y-4">
                <p className="text-sm text-fg-muted">{endpoint.description}</p>
                {endpoint.pathParams ? (
                  <FieldList title="Path parameters" fields={endpoint.pathParams} />
                ) : null}
                {endpoint.headers ? <FieldList title="Headers" fields={endpoint.headers} /> : null}
                {endpoint.query ? (
                  <FieldList title="Query parameters" fields={endpoint.query} />
                ) : null}
                {endpoint.body ? (
                  <FieldList title="JSON body" fields={endpoint.body.fields} />
                ) : null}
                <div className="grid gap-4 xl:grid-cols-2">
                  <CodeBlock code={curlFor(endpoint, origin)} label="Request" language="shell" />
                  <CodeBlock
                    code={responseFor(endpoint)}
                    label={`Response ${endpoint.successStatus}`}
                    language="json"
                  />
                </div>
                {endpoint.id === 'create-transfer' ? (
                  <CodeBlock
                    code={payoutSample(origin)}
                    label="Mobile-money payout"
                    language="shell"
                  />
                ) : null}
                <p className="text-xs text-fg-muted">
                  Errors:{' '}
                  {endpoint.errors.map((code, index) => (
                    <span key={code}>
                      {index > 0 ? ', ' : ''}
                      <a href="#errors" className="font-mono hover:underline">
                        {code}
                      </a>
                    </span>
                  ))}
                </p>
              </CardBody>
            </Card>
          ))}
        </section>

        <Card id="errors" className="scroll-mt-28">
          <CardHeader
            title="Errors"
            description="Every error is an RFC 9457 problem document (application/problem+json)"
          />
          <CardBody className="space-y-4">
            <p className="text-sm text-fg-muted">
              Branch on <code className="font-mono text-fg">code</code> (stable), show{' '}
              <code className="font-mono text-fg">detail</code> to humans, and quote{' '}
              <code className="font-mono text-fg">requestId</code> to support. Validation errors
              list the offending fields under <code className="font-mono text-fg">errors</code>.
            </p>
            <CodeBlock code={pretty(PROBLEM_EXAMPLE)} label="Problem document" language="json" />
            <div className="overflow-hidden rounded-lg border border-border">
              <Table caption="Error codes">
                <THead>
                  <Tr>
                    <Th>Code</Th>
                    <Th>HTTP</Th>
                    <Th>Meaning</Th>
                  </Tr>
                </THead>
                <TBody>
                  {API_ERRORS.map((error) => (
                    <Tr key={error.code}>
                      <Td>
                        <code className="font-mono text-[0.8125rem]">{error.code}</code>
                      </Td>
                      <Td>{error.status}</Td>
                      <Td className="text-fg-muted">{error.meaning}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>

        <Card id="webhooks" className="scroll-mt-28">
          <CardHeader
            title="Webhooks"
            description="Signed events pushed to your server when a transfer changes state"
            action={
              <Link
                href="/partner/webhooks"
                className="text-sm font-medium text-accent hover:underline"
              >
                Manage endpoints →
              </Link>
            }
          />
          <CardBody className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border">
              <Table caption="Webhook event types">
                <THead>
                  <Tr>
                    <Th>Event</Th>
                    <Th>Sent when</Th>
                  </Tr>
                </THead>
                <TBody>
                  {WEBHOOK_EVENTS.map((event) => (
                    <Tr key={event.type}>
                      <Td>
                        <code className="font-mono text-[0.8125rem]">{event.type}</code>
                      </Td>
                      <Td className="text-fg-muted">{event.when}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <CodeBlock code={WEBHOOK_HEADERS_SAMPLE} label="Delivery request" language="http" />
              <CodeBlock
                code={pretty(WEBHOOK_PAYLOAD_EXAMPLE)}
                label="Delivery body"
                language="json"
              />
            </div>
            <h3 className="text-sm font-semibold text-fg">Verify every delivery</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
              <li>
                Read the <strong>raw</strong> body, before any JSON parsing or re-serialisation.
              </li>
              <li>
                Split <code className="font-mono text-fg">x-birem-signature</code> into{' '}
                <code className="font-mono text-fg">t</code> (Unix seconds) and{' '}
                <code className="font-mono text-fg">v1</code>.
              </li>
              <li>
                Compute{' '}
                <code className="font-mono text-fg">
                  HMAC-SHA256(secret, t + &quot;.&quot; + rawBody)
                </code>{' '}
                as hex and compare it to <code className="font-mono text-fg">v1</code> in constant
                time.
              </li>
              <li>
                Refuse timestamps more than 5 minutes away from your clock, and ignore an event{' '}
                <code className="font-mono text-fg">id</code> you have already processed.
              </li>
            </ol>
            <CodeBlock code={VERIFY_NODE} label="Verification" language="Node.js" />
            <CodeBlock code={VERIFY_PYTHON} label="Verification" language="Python" />
            <Alert
              tone="warning"
              title="Delivery is at most once per attempt — there is no automatic retry"
            >
              BI-Rem Lite has no queue: each event is POSTed once, inline, with a 3-second timeout
              and no redirects. Answer <code className="font-mono">2xx</code> quickly and do the
              work afterwards. A delivery that fails is logged under{' '}
              <Link href="/partner/webhooks" className="font-medium underline">
                Webhooks
              </Link>{' '}
              where you can retry it; a retry reuses the event <code className="font-mono">id</code>{' '}
              with a fresh signature. Reconcile with{' '}
              <code className="font-mono">GET /api/v1/transfers</code> — the API is the source of
              truth. Automatic retries with back-off arrive with the full platform (phase 9).
            </Alert>
          </CardBody>
        </Card>

        <Card id="sandbox" className="scroll-mt-28">
          <CardHeader
            title="Sandbox cheat sheet"
            description="How the simulated operators answer"
            action={<SimulatedBadge />}
          />
          <CardBody className="space-y-4">
            <p className="text-sm text-fg-muted">
              Every mobile-money provider in this deployment is a deterministic simulator. The last
              four digits of the account number decide the outcome of a payout; any other number
              succeeds immediately.
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              <Table caption="Simulated payout outcomes by account suffix">
                <THead>
                  <Tr>
                    <Th>Account ends with</Th>
                    <Th>Outcome</Th>
                  </Tr>
                </THead>
                <TBody>
                  {SIMULATOR_SCENARIOS.map((scenario) => (
                    <Tr key={scenario.suffix}>
                      <Td>
                        <code className="font-mono text-[0.8125rem]">…{scenario.suffix}</code>
                      </Td>
                      <Td className="text-fg-muted">{scenario.label}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            {getEnv().seedDemoData ? (
              <p className="text-sm text-fg-muted">
                Wallet recipients to try: <code className="font-mono text-fg">+237699000101</code>{' '}
                (same currency), <code className="font-mono text-fg">joao@example.com</code> (XAF →
                AOA, needs <code className="font-mono text-fg">purpose</code> and{' '}
                <code className="font-mono text-fg">sourceOfFunds</code>), merchant code{' '}
                <code className="font-mono text-fg">M-DEMO01</code>. These demo accounts are seeded
                on this deployment.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
