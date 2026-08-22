[Tiếng Việt](architecture.md) | [English](architecture.en.md)

# Software Architecture

## 1. Scope

Store MGMT is a self-hosted point-of-sale system for one store per installation. The architecture prioritizes transaction correctness, cross-session consistency, and operational independence.

Primary quality attributes:

- **Consistency:** the API is the authoritative data source.
- **Integrity:** financial values and state transitions are validated by the server.
- **Operability:** the complete runtime is packaged with Docker Compose.
- **Auditability:** administrative actions and significant state changes are recorded.
- **Data ownership:** data remains within infrastructure controlled by the operator.

## 2. Component topology

```text
Browser on a computer / tablet
          │ HTTPS
          ▼
       Nginx
       ├── Static frontend
       └── /api/* ─────────────► Node.js API
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  Primary PostgreSQL       Archive PostgreSQL
                         │                         ▲
                         └──── Archive Worker ────┘
                                      │
                                      ▼
                                Cold Archive
```

## 3. Responsibilities

| Component | Responsibility |
|---|---|
| React/Vite | User interface, interaction state, receipt preview, and WebUSB |
| Nginx | Static delivery, API reverse proxy, and security headers |
| Node.js API | Authentication, authorization, business rules, reporting, and audit |
| Primary PostgreSQL | Catalog, configuration, sessions, audit, and active transactions |
| Archive PostgreSQL | Transaction history outside the primary retention window |
| Archive Worker | Historical transfer and cold-archive generation |

## 4. Consistency model

- The browser submits intent and input data; the API recalculates totals from order lines before persistence.
- Cross-table invariants are protected with PostgreSQL transactions.
- A `PAID` order is immutable in normal workflows; deletion is restricted to Admin and must create an audit record.
- Every session in one deployment shares the same `STORE_ID` and authoritative data source.
- LocalStorage contains device preferences such as theme and language, never authoritative business data.

## 5. Data lifecycle

Active data remains in primary PostgreSQL for low-latency operational queries. Data older than 60 days moves to archive PostgreSQL; sufficiently old archive data is packaged into cold storage. Tier transitions preserve order identity and business meaning.

The Archive Worker is outside the sales request path. Worker failure does not block current transactions, but increases the archival backlog and requires operational attention.

## 6. Security

- Authentication, authorization, and business invariants are enforced by the API.
- Passwords are derived with scrypt; sessions have bounded lifetime and count.
- The frontend bundle contains no credentials or infrastructure secrets.
- Databases must be restricted to an internal network or loopback; application traffic passes through an HTTPS reverse proxy.

## 7. Deployment and failure model

The frontend and API are stateless; durable state resides in PostgreSQL and Docker data volumes. Schema migrations complete before the API starts.

The current Docker Compose topology is single-node and provides no high availability. Loss of primary PostgreSQL stops writes. Loss of the archive subsystem preserves current transactions but affects corresponding historical queries. Recovery depends on backups proven by restore tests.

## 8. Evolution principles

- Schema changes must remain compatible during version transitions.
- Browser-local data must not simulate store or tenant isolation.
- Multi-store and multi-tenant designs require dedicated data isolation, authorization scopes, and migration strategies.
