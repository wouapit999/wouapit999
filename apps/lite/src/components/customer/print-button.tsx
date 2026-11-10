'use client';

import { Button, type ButtonProps } from '@/components/ui/button';

/** Opens the browser's print dialog (the shell chrome is hidden by the `no-print` rules). */
export function PrintButton({ children = 'Print', ...rest }: Omit<ButtonProps, 'onClick'>) {
  return (
    <Button {...rest} onClick={() => window.print()}>
      {children}
    </Button>
  );
}
