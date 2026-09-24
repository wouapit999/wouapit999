"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms";
import { Alert, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { importReadingsAction, type ImportResult } from "../actions";

export function ImportReadingsForm({ labels }: { labels: { csv: string; hint: string; submit: string; result: string; errors: string; line: string; error: string } }) {
  const [state, formAction] = useActionState<ActionResult<ImportResult> | null, FormData>(importReadingsAction, null);
  const data = state?.ok ? state.data : undefined;
  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {data && (
        <Alert tone={data.errors.length ? "warn" : "success"}>
          {labels.result.replace("{ok}", String(data.imported)).replace("{failed}", String(data.errors.length))}
        </Alert>
      )}
      {data && data.errors.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>{labels.line}</Th>
              <Th>{labels.error}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.errors.map((e, i) => (
              <Tr key={i}>
                <Td>{e.line}</Td>
                <Td>{e.error}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Textarea label={labels.csv} name="csv" required rows={12} hint={labels.hint} placeholder={"serial,date,value\nM-001,2026-01-31,1234.5"} className="font-mono" />
      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
