'use client';

import { useCallback, useState } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError } from '@/lib/api';

/**
 * Wraps an async submit handler: tracks the root error and maps API field errors onto the form.
 * Field paths are matched by name; unmatched ones stay on the root error.
 */
export function useSubmitHandler<TValues extends FieldValues>(setError: UseFormSetError<TValues>) {
  const [rootError, setRootError] = useState<unknown>(null);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setRootError(null);
      try {
        await action();
      } catch (error) {
        if (isApiError(error) && error.errors.length > 0) {
          let mapped = false;
          for (const fieldError of error.errors) {
            if (fieldError.path && fieldError.path !== '(root)') {
              setError(fieldError.path as Path<TValues>, {
                type: 'server',
                message: fieldError.message,
              });
              mapped = true;
            }
          }
          if (mapped && !error.detail) return;
        }
        setRootError(error);
      }
    },
    [setError],
  );

  return { rootError, run, clearRootError: () => setRootError(null) };
}
