"use client";

import { useMemo, useState } from "react";
import { Field, inputClass } from "@/components/ui";

export interface PickerBuilding {
  id: string;
  name: string;
}

export interface PickerUnit {
  id: string;
  propertyId: string;
  label: string;
  /** Optional residents (e.g. active-lease tenants) for host selection. */
  tenants?: { id: string; name: string }[];
}

/**
 * Cascading building → unit (→ resident) selects. Pure convenience: the server re-validates that
 * the unit belongs to the building and that every ID is inside the user's scope.
 */
export function LocationPicker({
  buildings,
  units,
  labels,
  defaultPropertyId,
  defaultUnitId,
  buildingRequired = true,
  unitRequired = false,
  withTenant = false,
  propertyName = "propertyId",
  unitName = "unitId",
  tenantName = "tenantId",
  idPrefix = "",
}: {
  buildings: PickerBuilding[];
  units: PickerUnit[];
  labels: { building: string; unit: string; tenant?: string; none: string; choose: string };
  defaultPropertyId?: string;
  defaultUnitId?: string;
  buildingRequired?: boolean;
  unitRequired?: boolean;
  withTenant?: boolean;
  propertyName?: string;
  unitName?: string;
  tenantName?: string;
  /** Prefix for element IDs when the picker appears in several forms on one page. */
  idPrefix?: string;
}) {
  const initialProperty =
    defaultPropertyId ?? (defaultUnitId ? units.find((u) => u.id === defaultUnitId)?.propertyId : undefined) ?? (buildings.length === 1 ? buildings[0].id : "");
  const [propertyId, setPropertyId] = useState(initialProperty ?? "");
  const [unitId, setUnitId] = useState(defaultUnitId ?? "");
  const visibleUnits = useMemo(() => units.filter((u) => u.propertyId === propertyId), [units, propertyId]);
  const tenants = useMemo(() => units.find((u) => u.id === unitId)?.tenants ?? [], [units, unitId]);

  return (
    <>
      <Field label={labels.building} name={`${idPrefix}${propertyName}`} required={buildingRequired}>
        <select
          id={`${idPrefix}${propertyName}`}
          name={propertyName}
          required={buildingRequired}
          className={inputClass}
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setUnitId("");
          }}
        >
          <option value="">{buildingRequired ? labels.choose : labels.none}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Field>
      <Field label={labels.unit} name={`${idPrefix}${unitName}`} required={unitRequired}>
        <select id={`${idPrefix}${unitName}`} name={unitName} required={unitRequired} className={inputClass} value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!propertyId}>
          <option value="">{unitRequired ? labels.choose : labels.none}</option>
          {visibleUnits.map((u) => (
            <option key={u.id} value={u.id}>{u.label}</option>
          ))}
        </select>
      </Field>
      {withTenant && (
        <Field label={labels.tenant ?? ""} name={`${idPrefix}${tenantName}`}>
          <select id={`${idPrefix}${tenantName}`} name={tenantName} className={inputClass} disabled={!unitId} defaultValue="" key={unitId}>
            <option value="">{labels.none}</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
