'use client';

import { useState } from 'react';

import { ActionForm, FormMessage, Input, SubmitButton } from '@/components/ui';

import { loginAction } from '../actions';

/** Sign-in form. The 6-digit code field appears once the server says the account uses MFA. */
export function LoginForm({ next }: { next?: string }) {
  const [needsCode, setNeedsCode] = useState(false);
  return (
    <ActionForm
      action={loginAction}
      className="space-y-4"
      onResult={(state) => {
        if (state.fieldErrors?.totpCode) setNeedsCode(true);
      }}
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        name="email"
        type="email"
        label="E-mail"
        autoComplete="username"
        inputMode="email"
        required
      />
      <Input
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      {needsCode ? (
        <Input
          name="totpCode"
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          required
        />
      ) : null}
      <FormMessage />
      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
