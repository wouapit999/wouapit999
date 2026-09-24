# Route checklist by role

Use this as the manual end-to-end script (seeded demo data, password in README). ✔ = should load; ✖ = must show 403 / redirect.

| Route | Admin | Manager | Owner | Accountant | Cashier | Concierge | Maint. mgr | Technician | Vendor | Auditor | Tenant |
|---|---|---|---|---|---|---|---|---|---|---|---|
| /dashboard | ✔ full | ✔ ops+finance | ✔ ops+finance | ✔ finance | ✔ | ✔ desk | ✔ ops | ✔ my jobs | ✔ my jobs | ✔ | → /portal/home |
| /properties, /units | ✔ | ✔ | ✔ read | ✔ read | ✔ read | buildings only | ✔ read | ✖ | ✖ | ✔ read | ✖ |
| /tenants | ✔ | ✔ | ✖ | ✔ read | ✔ read | ✖ | ✖ | ✖ | ✖ | ✔ read | ✖ |
| /leases | ✔ | ✔ | ✔ read | ✔ read | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ read | ✖ |
| /invoices, /payments | ✔ | read | read | ✔ | record | ✖ | ✖ | ✖ | ✖ | read | ✖ |
| /receipts | ✔ | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| /arrears, /deposits | ✔ | ✔ | ✔ read | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ read | ✖ |
| /maintenance | ✔ | ✔ | read | ✖ | ✖ | report | ✔ | assigned only | vendor jobs only | read | ✖ |
| /inspections, /vendors | ✔ | ✔ | ✖ | vendors | ✖ | ✖ | ✔ | ✖ | ✖ | read | ✖ |
| /expenses | ✔ | ✔ | read + approve | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | read | ✖ |
| /concierge/* | ✔ | directory only | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| /documents | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| /announcements, /messages | ✔ | ✔ | read | read | read | read | read | read | ✖ | read | ✖ |
| /reports | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ | operational | ✖ | ✖ | ✔ | ✖ |
| /admin/* | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | audit logs | ✖ |
| /platform | superadmin@ only |
| /portal/* | ✖ (staff) | | | | | | | | | | ✔ own data only |

## Scenario script (spec §18 end-to-end list)

1. admin → Administration → Branding: change app name and upload a logo → visible on login page, sidebar, invoices and receipts.
2. admin → Buildings → New building; add units.
3. manager → Tenants → New tenant; Leases → New lease (unit + tenant) → Submit.
4. admin → lease → Approve & activate → rent schedule appears on the lease page.
5. accountant → Invoices → New invoice (issue immediately).
6. cashier → Payments → Record payment (partial) → receipt printable with verification code; `/verify/<code>` confirms it publicly.
7. tenant → /portal/billing shows the updated balance.
8. tenant → /portal/maintenance → New request.
9. maintenance.manager → Maintenance → assign to technician.
10. technician → work order → In progress → upload evidence → Completed.
11. concierge → Visitors check-in (host notified) and Parcels log.
12. admin → Roles → edit a custom role's permissions (re-auth prompt) → takes effect on the next request.
13. admin → Users → user → Send reset link (link shown once; password never visible).
14. manager of building A cannot open `/leases/<id-in-building-B>` or `/tenants/<other-tenant>` (404); tenant cannot open `/portal/billing/<another tenant's invoice>` (404).
