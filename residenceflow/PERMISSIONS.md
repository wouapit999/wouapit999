# Permissions

_Generated from `src/lib/permissions.ts` by `npm run docs:permissions`. Do not edit by hand._

Authorization is enforced on the server in every page (`requireContext`), server action (`authorize`), route handler and service. Record-level scope is applied through the helpers in `src/lib/auth/context.ts`.

## Scopes

| Scope | Meaning |
|---|---|
| PLATFORM | Platform operators only; no tenant or financial data |
| ORGANIZATION | Every building of the user's organization |
| ASSIGNED_BUILDINGS | Only buildings listed in the user's building assignments |
| ASSIGNED_UNITS | Reserved; currently treated like ASSIGNED_BUILDINGS |
| OWN | Own records only (tenant portal, assigned work orders, vendor jobs) |

When a user holds several roles, permissions are unioned and the broadest scope applies.

## Default roles

| Role | Key | Scope | Description |
|---|---|---|---|
| Organization Administrator | `org_admin` | ORGANIZATION | Full control of the organization, its configuration, users and data. |
| Property Manager | `property_manager` | ASSIGNED_BUILDINGS | Manages assigned buildings, tenants, leases and operations. |
| Property Owner | `owner` | ASSIGNED_BUILDINGS | Read access to owned buildings, finances and statements. |
| Accountant / Finance Officer | `accountant` | ORGANIZATION | Invoices, payments, reconciliation, deposits and expenses. |
| Cashier / Rent Collector | `cashier` | ASSIGNED_BUILDINGS | Records payments and issues receipts. |
| Concierge / Security Desk | `concierge` | ASSIGNED_BUILDINGS | Visitors, parcels, incidents, shifts and building notices. |
| Tenant | `tenant` | OWN | Tenant self-service portal. Own records only. |
| Occupant / Household Member | `occupant` | OWN | Limited portal: announcements and maintenance requests. |
| Maintenance Manager | `maintenance_manager` | ASSIGNED_BUILDINGS | Triage, assign and close work orders; manage vendors. |
| Maintenance Technician | `technician` | OWN | Works on assigned work orders only. |
| Vendor / Contractor | `vendor` | OWN | Sees only work orders assigned to their company. |
| Auditor (read-only) | `auditor` | ORGANIZATION | Read-only access to records, reports and audit history. |
| Platform Super Administrator | `super_admin` | PLATFORM | Operates the platform: organizations, health, feature flags. |

## Permission matrix

✔ = granted by default. Custom roles can be built from any organization permission in **Administration → Roles**.

| Permission | Admin | Mgr | Owner | Acct | Cash | Conc | Ten | Occ | MaintMgr | Tech | Vend | Aud | Super |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **dashboard** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `dashboard.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  | ✔ | ✔ | ✔ | ✔ |  |
| `dashboard.financial.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| **building** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `building.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  | ✔ |  |  | ✔ |  |
| `building.create` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `building.update` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `building.archive` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| **unit** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `unit.view` | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  | ✔ |  |
| `unit.manage` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| **tenant** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tenant.view` | ✔ | ✔ |  | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |
| `tenant.create` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `tenant.update` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `tenant.sensitive.view` | ✔ |  |  |  |  |  |  |  |  |  |  | ✔ |  |
| `tenant.notes.view` | ✔ | ✔ |  |  |  |  |  |  |  |  |  | ✔ |  |
| **lease** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `lease.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `lease.create` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `lease.approve` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `lease.activate` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `lease.terminate` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| **invoice** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `invoice.view` | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |
| `invoice.create` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| `invoice.issue` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| `invoice.void` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| **payment** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `payment.view` | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |
| `payment.record` | ✔ |  |  | ✔ | ✔ |  |  |  |  |  |  |  |  |
| `payment.approve` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| `payment.reverse` ⚠ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| **receipt** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `receipt.view` | ✔ | ✔ |  | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |
| **arrears** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `arrears.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `arrears.manage` | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |
| **deposit** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `deposit.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `deposit.manage` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| `deposit.approve` | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |  |
| **maintenance** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `maintenance.view` | ✔ | ✔ | ✔ |  |  | ✔ |  |  | ✔ | ✔ | ✔ | ✔ |  |
| `maintenance.create` | ✔ | ✔ |  |  |  | ✔ |  |  | ✔ |  |  |  |  |
| `maintenance.assign` | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |
| `maintenance.update` | ✔ | ✔ |  |  |  |  |  |  | ✔ | ✔ | ✔ |  |  |
| `maintenance.close` | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |
| **inspection** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `inspection.view` | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  | ✔ |  |
| `inspection.manage` | ✔ | ✔ |  |  |  |  |  |  | ✔ |  |  |  |  |
| **vendor** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `vendor.view` | ✔ | ✔ |  | ✔ |  |  |  |  | ✔ |  |  | ✔ |  |
| `vendor.manage` | ✔ |  |  | ✔ |  |  |  |  | ✔ |  |  |  |  |
| **expense** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `expense.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  | ✔ |  |  | ✔ |  |
| `expense.create` | ✔ | ✔ |  | ✔ |  |  |  |  | ✔ |  |  |  |  |
| `expense.approve` | ✔ |  | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| **concierge** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `concierge.directory.view` | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  | ✔ |  |
| `concierge.visitors.manage` | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| `concierge.parcels.manage` | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| `concierge.incidents.manage` | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| `concierge.shifts.manage` | ✔ |  |  |  |  | ✔ |  |  |  |  |  |  |  |
| **document** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `document.view` | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `document.upload` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| `document.sensitive.view` | ✔ |  |  |  |  |  |  |  |  |  |  | ✔ |  |
| **announcement** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `announcement.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  | ✔ | ✔ |  | ✔ |  |
| `announcement.manage` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| **message** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `message.view` | ✔ | ✔ |  |  |  |  |  |  |  |  |  | ✔ |  |
| `message.send` | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| **report** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `report.operational.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  | ✔ |  |  | ✔ |  |
| `report.financial.view` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |
| `report.export` | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| **settings** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.general.manage` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.branding.manage` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.roles.manage` ⚠ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.security.manage` ⚠ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.financial.manage` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.notifications.manage` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `settings.integrations.manage` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| **users** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.view` | ✔ |  |  |  |  |  |  |  |  |  |  | ✔ |  |
| `users.manage` ⚠ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.password_reset` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.mfa_reset` ⚠ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| **audit** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `audit.view` | ✔ |  |  |  |  |  |  |  |  |  |  | ✔ |  |
| `audit.export` | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| **system** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.status.view` | ✔ |  |  |  |  |  |  |  |  |  |  | ✔ | ✔ |
| **portal** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `portal.access` |  |  |  |  |  |  | ✔ | ✔ |  |  |  |  |  |
| **platform** |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.organizations.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ✔ |

⚠ Powerful permissions: only users holding `settings.roles.manage` can grant roles containing them. Changing role permissions, resetting MFA and security settings require recent re-authentication.

## Guard rails

- The last active user holding `settings.roles.manage` in an organization cannot be suspended, archived or stripped of it.
- `platform.*` permissions can never be granted to organization roles.
- A role cannot be archived while users are assigned to it.
- Tenants and occupants hold only `portal.access`; portal queries are always filtered by the tenant bound to the user.
- Technicians see only work orders assigned to them; vendor users only their company's work orders.
- Concierge roles have no invoice/payment/lease permissions; the resident directory shows name, unit and phone only.
