"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Input, Textarea, inputClass } from "@/components/ui";
import { LocationPicker, type PickerBuilding, type PickerUnit } from "@/components/ops/location-picker";
import type { ActionResult } from "@/lib/action";

export function RequestForm({
  action,
  buildings,
  units,
  categories,
  priorities,
  emergencyInstructions,
  m,
  defaultPropertyId,
  defaultUnitId,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  buildings: PickerBuilding[];
  units: PickerUnit[];
  categories: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  emergencyInstructions: string;
  m: Record<string, string>;
  defaultPropertyId?: string;
  defaultUnitId?: string;
}) {
  const [safety, setSafety] = useState(false);
  const [priority, setPriority] = useState("NORMAL");
  const emergency = safety || priority === "URGENT";

  return (
    <ActionForm action={action}>
      {emergency && (
        <div role="alert" className="rounded-md border-2 border-red-600 bg-red-50 p-4 text-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="text-base font-semibold">⚠ {m.emergencyTitle}</p>
          <p className="mt-1 text-sm whitespace-pre-line">{emergencyInstructions}</p>
          <p className="mt-2 text-sm font-medium">{m.notEmergency}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <LocationPicker
          buildings={buildings}
          units={units}
          defaultPropertyId={defaultPropertyId}
          defaultUnitId={defaultUnitId}
          labels={{ building: m.building, unit: m.unit, none: m.commonArea, choose: m.choose }}
        />
        <Field label={m.category} name="category" required>
          <select id="category" name="category" required className={inputClass} defaultValue="">
            <option value="" disabled>{m.choose}</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label={m.priority} name="priority" required>
          <select id="priority" name="priority" required className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {priorities.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <input type="checkbox" name="safetyIssue" className="mt-0.5 h-5 w-5 accent-red-700" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
        <span>
          <span className="font-medium">{m.safety}</span>
          <span className="block text-xs">{m.safetyHint}</span>
        </span>
      </label>
      <Input label={m.title} name="title" required minLength={3} maxLength={150} />
      <Textarea label={m.description} name="description" required minLength={3} maxLength={4000} rows={4} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={m.location} name="location" hint={m.locationHint} maxLength={200} />
        <Input label={m.access} name="accessPreference" hint={m.accessHint} maxLength={300} />
        <Input label={m.availableTimes} name="availableTimes" maxLength={300} />
        <Field label={m.photo} name="photo" hint={m.photoHint}>
          <input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" capture="environment" className="block w-full text-sm" />
        </Field>
      </div>
      <Checkbox label={m.onBehalf} name="onBehalfOfTenant" defaultChecked />
      <SubmitButton className="w-full sm:w-auto">{m.submit}</SubmitButton>
    </ActionForm>
  );
}
