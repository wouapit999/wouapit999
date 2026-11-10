# BI-Rem — Documentation Index

| Item                      | Value                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Programme                 | **BI-Rem** — pan-African remittance and mobile-money platform, 13 independently deployable phases                      |
| Window                    | **2026-11-16 → 2028-06-30** (85 weeks) · production go-live **2027-12-10** (Phase 12 exit)                             |
| Target scale              | 1,000,000 users · 100,000 transfers/day · 50 providers · 20 countries · 99.9 % availability · RPO 15 min · RTO 60 min  |
| Source of truth for dates | [`roadmap/schedule.json`](./roadmap/schedule.json) — every date in this documentation set is copied from it            |
| Repository conventions    | [`CLAUDE.md`](../CLAUDE.md) (stack, conventions, docs rules) · [repository README](../README.md) (how to run the code) |
| Index owner               | Program Manager                                                                                                        |

---

## 1. Programme deliverables (00–09)

Read in order for a board or steering-committee briefing; each document links back to the phase plans for detail.

| #   | Document                                                     | One-line description                                                                                                                                                                                                                                | Owner                             |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 00  | [Implementation roadmap](./00-implementation-roadmap.md)     | Executive summary, phase sequence, release waves, staffing plan and the decisions asked of the steering committee                                                                                                                                   | Program Manager                   |
| 01  | [Gantt chart & critical path](./01-gantt-chart.md)           | Mermaid Gantt of all 13 phases by team track and gates, Phase 1–3 milestone zoom, plain-text month grid fallback, critical path                                                                                                                     | Program Manager                   |
| 02  | [Milestone tracker & phase gates](./02-milestone-tracker.md) | Every milestone M1.1 → M13.13 with date, owner and acceptance criteria, plus gate definitions G1–G13                                                                                                                                                | Program Manager                   |
| 03  | [Dependency map](./03-dependency-map.md)                     | Phase-to-phase and component dependencies, handover artefacts, external dependencies (licences, providers, banks)                                                                                                                                   | Solution Architect                |
| 04  | [Budget estimates](./04-budget-estimates.md)                 | Labour and external cost ranges per phase, programme-level costs, contingency and volume-driven fees (machine-readable in [`budget.csv`](./roadmap/budget.csv))                                                                                     | Program Manager + Finance Lead    |
| 05  | [Infrastructure estimates](./05-infrastructure-estimates.md) | Sizing from 100,000 transfers/day to requests per second, capacity model, components and run-rate per stage from Phase 1 to scale, multi-region and DR, scaling triggers (machine-readable in [`infrastructure.csv`](./roadmap/infrastructure.csv)) | DevOps/SRE Lead                   |
| 06  | [Risk register](./06-risk-register.md)                       | Consolidated programme and phase risks with scores, mitigations, contingencies, owners and triggers (machine-readable in [`risk-register.csv`](./roadmap/risk-register.csv))                                                                        | Program Manager                   |
| 07  | [Go-live checklist](./07-go-live-checklist.md)               | Master production-readiness checklist for Phase 12 and every later market launch, with evidence per item                                                                                                                                            | Program Manager + DevOps/SRE Lead |
| 08  | [Operational handbook](./08-operational-handbook.md)         | How BI-Rem is run in production: operating model, access, releases, routines, incident management, runbooks, capacity, cost, vendors, continuity                                                                                                    | COO                               |
| 09  | [Support handbook](./09-support-handbook.md)                 | Customer and partner support: tiers, channels, SLAs, taxonomy, identity verification, playbooks, escalation, macros en/fr/pt, KB, QA, KPIs, fraud awareness                                                                                         | Head of Customer Operations       |

Headline figures across the set (ranges with assumptions are stated in each document): programme total **USD 4.5–11.3 M** including contingency and volume-driven fees ([`budget.csv`](./roadmap/budget.csv) row `total`); platform run-rate at scale **USD 11.8–35.4 k per month** ([`infrastructure.csv`](./roadmap/infrastructure.csv), stage `scale`).

---

## 2. Phase plans

Each phase plan has the same 15 sections (Overview, Milestones, Deliverables, Architecture, Data Model & Migrations, API & Integration Surface, Portal Changes, Security & Compliance, Test Plan, CI/CD Pipeline, Production Readiness Checklist, Success Criteria Verification, Risks & Mitigations, Effort & Cost Drivers, Dependencies & Handover), enforced by the docs checker.

| Phase | Plan                                                                   | Start      | End        | Weeks | Team       | Depends on   |
| ----- | ---------------------------------------------------------------------- | ---------- | ---------- | ----- | ---------- | ------------ |
| 1     | [Foundation & Platform Setup](./phases/phase-01-foundation.md)         | 2026-11-16 | 2026-12-25 | 6     | core       | —            |
| 2     | [Customer Management & KYC](./phases/phase-02-customer-kyc.md)         | 2026-12-28 | 2027-02-19 | 8     | core       | 1            |
| 3     | [Connectivity Management Framework](./phases/phase-03-connectivity.md) | 2027-01-25 | 2027-03-05 | 6     | platform   | 1            |
| 4     | [Wallet Connector Engine](./phases/phase-04-wallet-connectors.md)      | 2027-03-08 | 2027-04-30 | 8     | platform   | 3            |
| 5     | [Domestic Transfers](./phases/phase-05-domestic-transfers.md)          | 2027-04-19 | 2027-05-28 | 6     | core       | 2, 4         |
| 6     | [International Remittance](./phases/phase-06-international.md)         | 2027-05-31 | 2027-07-23 | 8     | core       | 5            |
| 7     | [FX & Treasury Management](./phases/phase-07-fx-treasury.md)           | 2027-06-28 | 2027-08-06 | 6     | platform   | 5            |
| 8     | [AML, Fraud & Compliance](./phases/phase-08-aml-compliance.md)         | 2027-07-26 | 2027-09-17 | 8     | compliance | 2, 6         |
| 9     | [Partner & Merchant Portal](./phases/phase-09-partner-merchant.md)     | 2027-08-23 | 2027-10-01 | 6     | core       | 5, 7         |
| 10    | [Reporting & Business Intelligence](./phases/phase-10-reporting-bi.md) | 2027-09-20 | 2027-10-29 | 6     | platform   | 6, 7, 8      |
| 11    | [Mobile Applications](./phases/phase-11-mobile.md)                     | 2027-08-09 | 2027-10-15 | 10    | mobile     | 2, 5, 6      |
| 12    | [Production Go-Live](./phases/phase-12-go-live.md)                     | 2027-11-01 | 2027-12-10 | 6     | all        | 8, 9, 10, 11 |
| 13    | [Pan-African Expansion](./phases/phase-13-pan-african-expansion.md)    | 2028-01-03 | 2028-06-30 | 26    | all        | 12           |

Phases overlap by design (for example Phase 5 starts 2027-04-19 while Phase 4 hardens to 2027-04-30); the dependency rules and handover artefacts are in the [dependency map](./03-dependency-map.md).

---

## 3. Architecture

| Document                                                                       | Scope                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Target architecture](./architecture/target-architecture.md)                   | End state at Phase 13 exit: context and container views, service decomposition and extraction roadmap, data architecture, multi-region cells, integration landscape, security architecture, NFRs vs target scale, technology radar, open items |
| [Infrastructure architecture](./architecture/infrastructure-architecture.md)   | Phase 1 system context, containers and deployment topology (Fly.io, Vercel, Neon), request flow, CI/CD flow, availability and recovery                                                                                                         |
| [Database schema v1](./architecture/database-schema-v1.md)                     | Phase 1 entities, ER diagram, conventions (uuid, `timestamptz`, BIGINT minor units), indexing, retention, migration workflow                                                                                                                   |
| [Environment management](./architecture/environment-management.md)             | Environments (local, preview, staging, production), variable catalogue, secret stores, Neon branching model                                                                                                                                    |
| [Monitoring framework](./architecture/monitoring-framework.md)                 | Signal map, metrics, logs, traces, SLOs and alerting, dashboards, KPI mapping                                                                                                                                                                  |
| [Security baseline](./architecture/security-baseline.md)                       | Threat model, identity and access, transport hardening, audit trail, data protection, secrets, supply chain                                                                                                                                    |
| [Phase 1 implementation notes](./architecture/phase-1-implementation-notes.md) | What was built in the Phase 1 code, module map, how to run and deploy, known gaps for Phase 2                                                                                                                                                  |

Phase-specific architecture (component diagrams, sequences, design decisions and alternatives rejected) lives in §4 of each phase plan; ADRs are numbered per phase and indexed in [target architecture §12](./architecture/target-architecture.md#12-architecture-decision-index).

---

## 4. Roadmap data (`docs/roadmap/`)

| File                                                       | Content                                                                                                                                                                                                                                                              | Consumed by                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`schedule.json`](./roadmap/schedule.json)                 | Master schedule: phase ids, keys, names, start/end dates, weeks, team, dependencies; team roster; target scale                                                                                                                                                       | Every document; the docs checker validates phase-plan dates against it                                                        |
| [`milestones.csv`](./roadmap/milestones.csv)               | All milestones with phase, target date, owner, acceptance, status                                                                                                                                                                                                    | [Milestone tracker](./02-milestone-tracker.md), status reporting                                                              |
| [`budget.csv`](./roadmap/budget.csv)                       | Labour and external cost ranges per phase plus programme-level lines, contingency and totals (USD)                                                                                                                                                                   | [Budget estimates](./04-budget-estimates.md)                                                                                  |
| [`infrastructure.csv`](./roadmap/infrastructure.csv)       | Infrastructure components per stage with monthly USD ranges and introducing phase                                                                                                                                                                                    | [Infrastructure estimates](./05-infrastructure-estimates.md), [target architecture §9](./architecture/target-architecture.md) |
| [`risk-register.csv`](./roadmap/risk-register.csv)         | Programme risks with likelihood, impact, score, mitigation, contingency, owner, trigger, status                                                                                                                                                                      | [Risk register](./06-risk-register.md)                                                                                        |
| [`index.html`](./roadmap/index.html) (interactive roadmap) | Browser view of the schedule (Gantt by team track), milestones (filter and search) and hard dependencies. Opened from disk it shows an embedded snapshot; served over HTTP (for example `npx serve docs/roadmap`) it reads `schedule.json` and `milestones.csv` live | Steering-committee walkthroughs                                                                                               |
| [`tools/check-docs.mjs`](./roadmap/tools/check-docs.mjs)   | Documentation checker (Mermaid render, relative links, phase dates, phase sections)                                                                                                                                                                                  | `pnpm docs:check`: run locally before every docs pull request; runs in CI as the `docs-check` job (required through `ci-ok`)  |

The CSV files are the machine-readable form of the deliverables; when a figure changes, change the CSV and the document together in the same pull request.

---

## 5. How to read the set

| Reader                       | Start with                                                                                   | Then                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Board / steering committee   | [00 Roadmap](./00-implementation-roadmap.md) §1                                              | [04 Budget](./04-budget-estimates.md), [06 Risks](./06-risk-register.md), [01 Gantt](./01-gantt-chart.md)                                                                            |
| Programme and delivery leads | [02 Milestones](./02-milestone-tracker.md)                                                   | [03 Dependencies](./03-dependency-map.md), the current phase plan                                                                                                                    |
| Engineers                    | The current phase plan §3–§10                                                                | [Target architecture](./architecture/target-architecture.md), Phase 1 architecture notes, [`CLAUDE.md`](../CLAUDE.md)                                                                |
| Operations, SRE, on-call     | [08 Operational handbook](./08-operational-handbook.md)                                      | [07 Go-live checklist](./07-go-live-checklist.md), [monitoring framework](./architecture/monitoring-framework.md)                                                                    |
| Customer operations          | [09 Support handbook](./09-support-handbook.md)                                              | §15 "support scenarios" of each phase plan                                                                                                                                           |
| Compliance, MLRO, auditors   | [Phase 8](./phases/phase-08-aml-compliance.md), [Phase 12](./phases/phase-12-go-live.md) §8  | [Security baseline](./architecture/security-baseline.md), [06 Risks](./06-risk-register.md), [target architecture §8](./architecture/target-architecture.md#8-security-architecture) |
| Finance and treasury         | [04 Budget](./04-budget-estimates.md), [05 Infrastructure](./05-infrastructure-estimates.md) | [Phase 5](./phases/phase-05-domestic-transfers.md), [Phase 7](./phases/phase-07-fx-treasury.md)                                                                                      |

Conventions used throughout: dates are ISO `YYYY-MM-DD` and match `schedule.json`; money is USD as ranges with the assumptions stated next to the figure; diagrams are Mermaid fenced blocks; phase references use `P<n>` or the phase name with a link; milestone ids are `M<phase>.<n>`, risk ids `R<phase>.<n>` (phase) or `PR-<nn>` (programme).

---

## 6. Keeping the documentation current

1. **Change dates only in `schedule.json` first**, then update every document that quotes them in the same pull request; the checker fails a phase plan whose start or end date is missing or whose milestone rows fall outside the phase window.
2. **Run the checker locally** before pushing:

   ```bash
   pnpm docs:check                                          # = node docs/roadmap/tools/check-docs.mjs — Mermaid render, links, dates, sections
   node docs/roadmap/tools/check-docs.mjs --no-mermaid      # fast run without rendering
   node docs/roadmap/tools/check-docs.mjs --only 09-support # one file or a substring of paths
   ```

   The root `package.json` exposes `"docs:check": "node docs/roadmap/tools/check-docs.mjs"`, and the `docs-check` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs it on every push and pull request with a Chrome installed for mermaid-cli; `ci-ok` requires it (owner: DevOps/SRE Lead).

   Mermaid rendering uses `@mermaid-js/mermaid-cli`; when no browser is available the checker falls back to syntax sanity checks and says so. Gantt task names must not contain `%` or parentheses; node ids must be alphanumeric; labels with special characters must be quoted.

3. **Link, don't copy.** Architecture notes, environment variables, alert rules and runbooks have one home; other documents link to it.
4. **Update at every gate.** At each phase exit the phase owner updates the phase plan with as-built deviations, the milestone status in [`milestones.csv`](./roadmap/milestones.csv), risks in [`risk-register.csv`](./roadmap/risk-register.csv), and the affected handbooks.
5. **Commit style**: Conventional Commits with a docs scope, e.g. `docs(phase-06): …`, `docs(roadmap): …`, `docs(support): …`.

---

## 7. Document ownership and review cadence

| Documents                                  | Accountable owner                 | Reviewers                                    | Cadence                                                   |
| ------------------------------------------ | --------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| 00–03, `schedule.json`, `milestones.csv`   | Program Manager                   | Solution Architect, phase leads              | Fortnightly steering pack; at every gate                  |
| 04, 05, `budget.csv`, `infrastructure.csv` | Program Manager + Finance Lead    | DevOps/SRE Lead                              | Monthly; at every gate                                    |
| 06, `risk-register.csv`                    | Program Manager                   | Risk owners                                  | Fortnightly                                               |
| 07                                         | Program Manager + DevOps/SRE Lead | All sign-off roles of Phase 12               | Before every go/no-go board and market launch             |
| 08                                         | COO (custodian DevOps/SRE Lead)   | Payments ops, treasury, compliance           | Quarterly; after every P1                                 |
| 09                                         | Head of Customer Operations       | MLRO, DPO, Head of Partnerships, Security    | Quarterly; at each phase exit                             |
| Phase plans `phases/phase-NN-*.md`         | Phase lead named in the plan      | Solution Architect, QA Lead, Security        | At design freeze (Mx.1) and phase exit                    |
| `architecture/*`                           | Solution Architect                | Backend, Frontend and DevOps leads, Security | At every ADR acceptance; target architecture at each gate |
| `tools/check-docs.mjs`                     | Solution Architect                | DevOps/SRE Lead                              | When a new document type is added                         |

---

## 8. Status of this index

Written 2026-11-10 against the repository contents at that date. All deliverables 00–09, the 13 phase plans, the six existing architecture notes plus the target architecture, the five roadmap data files, the interactive roadmap `roadmap/index.html` and the docs checker `roadmap/tools/check-docs.mjs` are present and listed above. The embedded snapshot in `index.html` dates from 2026-11-10; when served over HTTP the page reads the current `schedule.json` and `milestones.csv`.
