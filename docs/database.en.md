[Tiếng Việt](database.md) | [English](database.en.md)

# Data Architecture and Lifecycle

## 1. Persistence model

PostgreSQL is the authoritative data source. The model covers stores, identities and sessions, catalog data, orders, audit records, and daily cash balances.

Critical invariants are enforced by the database and API:

- primary keys use UUIDs; usernames and order numbers are unique within a store;
- monetary values use `numeric(12,2)` and cannot be negative;
- quantities are positive; roles, payment methods, and order states are constrained with `CHECK`;
- order lines preserve product-name and unit-price snapshots, so catalog changes cannot rewrite transaction history;
- deleting an order cascades to its lines; deleting a user cascades to that user's sessions.

`daily_cash_balances` uses the business date as its key because one deployment serves one store.

## 2. Storage tiers

| Tier | Purpose | Default retention |
|---|---|---|
| Primary PostgreSQL | Active transactions, catalog, identity, sessions, and operational queries | 60 days |
| Archive PostgreSQL | Paid orders and audit records outside the primary retention window | From day 60 |
| Cold archive | Monthly gzip-compressed JSON Lines with SHA-256 manifests | From day 365 |

`OPEN` orders are never archived, regardless of age. Long-range reports combine results from the primary and archive databases.

## 3. Transfer protocol

The Archive Worker processes up to 500 orders per batch:

1. select `PAID` orders by `updated_at` and audit records by `created_at`;
2. copy orders, lines, and audits to the archive database in one transaction;
3. verify record counts and a stable SHA-256 digest;
4. record the completed batch in `archive_batches`;
5. delete source records from the primary database in a separate transaction.

The transfer provides at-least-once semantics. UUIDs and `ON CONFLICT DO NOTHING` make retries safe if the process stops after copying but before source deletion.

Cold compaction groups data by month and writes `.jsonl.gz` files. Sizes and digests are recorded in `cold_archive_manifests`. Source deletion is disabled by default; enable `COLD_ARCHIVE_DELETE_SOURCE=true` only after the recovery procedure has been proven.

## 4. Query design

Composite and partial indexes support the primary access paths:

- order history: `(store_id, created_at DESC, id DESC)`;
- recently updated orders: `(store_id, updated_at DESC, id DESC)`;
- open orders: a partial index over `store_id, status, updated_at`;
- archive candidates: a partial index for `PAID` orders;
- audit chronology: `(store_id, created_at DESC, id DESC)`;
- catalog filtering by store, active state, category, and name;
- session expiry and cold-archive periods.

UUID tie-breakers provide stable pagination when records share a timestamp.

## 5. Schema evolution

`server/migrate.mjs` applies files in `db/migrations` in order and records versions in `schema_migrations`. The same migration set is applied to both databases before the API starts.

Production migrations must be forward-only, safe to repeat, and data-preserving. Incompatible changes require an expand–migrate–contract sequence rather than direct replacement.

## 6. Backup and recovery

A complete recovery set contains:

- a primary PostgreSQL dump;
- an archive PostgreSQL dump;
- the cold-archive volume;
- configuration required to recreate the deployment.

The backup schedule determines the recovery point. Recovery time must be measured through isolated restore drills. A backup is valid only after successful restoration and data verification.
