import type { T } from "@/i18n";

/** Role and building-scope checkboxes shared by the invite and edit forms. */
export function AccessFields({
  roles,
  properties,
  selectedRoles = [],
  selectedProperties = [],
  t,
}: {
  roles: { id: string; name: string; scope: string; disabled?: boolean; powerful?: boolean; inactive?: boolean }[];
  properties: { id: string; name: string; reference: string }[];
  selectedRoles?: string[];
  selectedProperties?: string[];
  t: T;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t("adm.users.roles")}</legend>
        <ul className="space-y-1">
          {roles.map((r) => {
            const checked = selectedRoles.includes(r.id);
            return (
              <li key={r.id}>
                <label className={`flex items-start gap-2 text-sm ${r.disabled ? "opacity-60" : ""}`}>
                  <input type="checkbox" name="roleIds" value={r.id} defaultChecked={checked} disabled={r.disabled} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                  <span>
                    {r.name} <span className="text-xs text-slate-500">({t(`adm.scope.${r.scope}`)})</span>
                    {r.powerful && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{t("adm.roles.powerful")}</span>}
                    {r.inactive && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">{t("adm.roles.inactive")}</span>}
                  </span>
                </label>
                {/* a disabled checkbox is not submitted: preserve roles the actor may not change */}
                {r.disabled && checked && <input type="hidden" name="roleIds" value={r.id} />}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t("adm.users.buildings")}</legend>
        <p className="mb-2 text-xs text-slate-500">{t("adm.users.buildingsHint")}</p>
        {properties.length === 0 ? (
          <p className="text-sm text-slate-500">{t("common.none")}</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {properties.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="propertyIds" value={p.id} defaultChecked={selectedProperties.includes(p.id)} className="h-4 w-4 accent-[var(--brand)]" />
                  {p.name} <span className="font-mono text-xs text-slate-500">{p.reference}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
