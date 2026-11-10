import { Checkbox, Input, Select, Textarea } from '@/components/ui';
import { humanize } from '@/lib/format';
import type { ProviderView } from '@/server/connectors';

/**
 * Non-secret provider settings, shared by the create and edit forms. Credentials and the
 * webhook secret have their own write-only forms on the provider page.
 */
export function ProviderFields({
  provider,
  countries,
  adapters,
  currencies,
}: {
  provider?: ProviderView;
  countries: ReadonlyArray<{ code: string; name: string; currency: string; enabled: boolean }>;
  adapters: ReadonlyArray<{ key: string; label: string; description: string }>;
  currencies: readonly string[];
}) {
  const config =
    provider && provider.config !== null && Object.keys(provider.config as object).length > 0
      ? JSON.stringify(provider.config, null, 2)
      : '';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {provider ? null : (
        <Input
          name="code"
          label="Code"
          hint="Lowercase letters, digits and dashes, e.g. mtn-momo-cm. Used in the webhook URL; cannot change later."
          required
          pattern="[a-z0-9][a-z0-9-]{2,40}"
          autoCapitalize="none"
          spellCheck={false}
        />
      )}
      <Input
        name="name"
        label="Display name"
        required
        defaultValue={provider?.name}
        maxLength={120}
      />
      <Input
        name="operator"
        label="Operator"
        hint="The mobile-money brand, e.g. MTN MoMo"
        required
        defaultValue={provider?.operator}
        maxLength={120}
      />
      <Select
        name="countryCode"
        label="Country"
        required
        placeholder="Choose a country"
        defaultValue={provider?.countryCode}
        options={countries.map((country) => ({
          value: country.code,
          label: `${country.name} (${country.code}) — ${country.currency}${country.enabled ? '' : ' · planned'}`,
        }))}
      />
      <Select
        name="currency"
        label="Settlement currency"
        required
        placeholder="Choose a currency"
        defaultValue={provider?.currency}
        options={currencies.map((currency) => ({ value: currency, label: currency }))}
      />
      <Select
        name="adapter"
        label="Adapter"
        required
        placeholder="Choose an adapter"
        defaultValue={provider?.adapter}
        hint={adapters.map((adapter) => `${adapter.label}: ${adapter.description}`).join(' ')}
        options={adapters.map((adapter) => ({ value: adapter.key, label: adapter.label }))}
      />
      <Select
        name="environment"
        label="Environment"
        required
        defaultValue={provider?.environment ?? 'SANDBOX'}
        hint="The simulator is sandbox-only; production needs a real adapter."
        options={[
          { value: 'SANDBOX', label: 'Sandbox' },
          { value: 'PRODUCTION', label: 'Production' },
        ]}
      />
      <Input
        name="baseUrl"
        type="url"
        label="Base URL"
        hint="HTTPS endpoint of the operator gateway (required for the HTTP adapter)."
        placeholder="https://gateway.operator.example"
        defaultValue={provider?.baseUrl ?? undefined}
        maxLength={500}
      />
      <Input
        name="callbackUrl"
        type="url"
        label="Callback URL"
        hint="Where the operator calls back; usually this app's webhook endpoint."
        placeholder="https://your-app.vercel.app/api/webhooks/providers/…"
        defaultValue={provider?.callbackUrl ?? undefined}
        maxLength={500}
      />
      <Select
        name="status"
        label="Status"
        required
        defaultValue={provider?.status ?? 'INACTIVE'}
        options={['ACTIVE', 'INACTIVE', 'MAINTENANCE'].map((status) => ({
          value: status,
          label: humanize(status),
        }))}
      />
      <div className="space-y-2 self-end">
        <Checkbox
          name="supportsPayout"
          label="Supports payouts"
          defaultChecked={provider?.supportsPayout ?? true}
        />
        <Checkbox
          name="supportsCollection"
          label="Supports collections (cash-in)"
          defaultChecked={provider?.supportsCollection ?? true}
        />
      </div>
      <Textarea
        name="config"
        label="Adapter configuration (JSON)"
        hint="Non-secret settings only — paths, timeouts, header names. Never put credentials here."
        rows={4}
        defaultValue={config}
        spellCheck={false}
        className="font-mono text-xs"
        containerClassName="sm:col-span-2"
      />
    </div>
  );
}
