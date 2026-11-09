'use client';

import { useCallback, useState } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';

/**
 * Runs a mutation from a react-hook-form submit handler: maps API field errors onto the form
 * (`setError`) and keeps the remaining message as a form-level error for an `Alert`.
 */
export function useSubmit<TValues extends FieldValues>(setError?: UseFormSetError<TValues>) {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const run = useCallback(
    async <TResult>(
      action: () => Promise<TResult>,
      knownFields: ReadonlyArray<Path<TValues>> = [],
    ): Promise<TResult | undefined> => {
      setFormError(null);
      setSubmitting(true);
      try {
        return await action();
      } catch (error) {
        let mapped = false;
        if (isApiError(error) && setError) {
          for (const [path, message] of Object.entries(error.fieldErrors())) {
            if ((knownFields as readonly string[]).includes(path)) {
              setError(path as Path<TValues>, { type: 'server', message });
              mapped = true;
            }
          }
        }
        if (!mapped || !isApiError(error) || error.detail) {
          setFormError(describeError(error));
        }
        return undefined;
      } finally {
        setSubmitting(false);
      }
    },
    [setError],
  );

  return { run, formError, setFormError, submitting };
}
