[Tiếng Việt](README.md) | [English](README.en.md)

# Store MGMT Community Edition

[![Docker smoke test](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml/badge.svg)](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

**A self-hosted point-of-sale and store operations platform.**

Store MGMT Community Edition is a free community release for stores that require centralized sales and operational data on self-managed infrastructure.

## Capabilities

- Touch-first sales workflow for computers and tablets.
- Product, category, tag, price, and availability management.
- Table, service type, deposit, discount, and payment management.
- Staff/Admin authorization, immutable paid orders, and administrative audit logs.
- Daily, monthly, and yearly revenue; payment mix; top products; opening and closing cash.
- 80 mm thermal receipt printing from the browser when the device recognizes the printer, with direct WebUSB ESC/POS support.
- Vietnamese and English interfaces and receipts with UTF-8 application data.

## System profile

| Property | Design |
|---|---|
| Scope | One store per deployment |
| Source of truth | Shared PostgreSQL data for all authenticated sessions |
| Retention | 60-day operational store, archive database, and cold archive |
| Sessions | Up to 10 sessions per account with a seven-day lifetime |
| Deployment | Docker Compose with separate web, API, archive worker, and database services |
| Printing | Browser print dialog or direct WebUSB ESC/POS |

## Linux installation

Requires Docker Engine, Docker Compose v2, Git, and OpenSSL.

```bash
git clone https://github.com/atgsolution/store-mgmt-community.git
cd store-mgmt-community
bash scripts/setup-linux.sh

docker compose config --quiet
docker compose up -d --build
docker compose ps
```

The application is served at `http://<server-address>:6086` by default. The health endpoint is `/healthz`.

Bootstrap accounts:

| Role | Username | Password |
|---|---|---|
| Administrator | `admin` | Chosen during setup |
| Staff | `staff` | Chosen during setup |

The setup script generates unique database passwords and stores only scrypt hashes for account passwords.

## Upgrades

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
```

Recreating containers does not remove Docker data volumes. Never run `docker compose down -v` on a deployment whose data must be preserved.

## Backup

```bash
docker compose exec -T hot-db \
  pg_dump -U store_mgmt -d store_mgmt_hot > hot-backup.sql

docker compose exec -T archive-db \
  pg_dump -U store_mgmt -d store_mgmt_archive > archive-backup.sql
```

A complete recovery set contains both database dumps and the cold-archive volume. A backup is valid only after a successful restore test.

## Security

- Passwords use scrypt with random salts; changing a password revokes the remaining sessions.
- Production must run behind an HTTPS reverse proxy with `COOKIE_SECURE=true`.
- Access control and business rules are enforced by the API.

## Scope limits

The Community Edition supports one store per deployment. Multi-store operation, multi-tenant hosting, electronic invoicing, and accounting integrations are outside the current scope.

## Documentation

- [Software architecture](docs/architecture.en.md)
- [Data architecture and lifecycle](docs/database.en.md)
- [Thermal printing architecture](docs/printer-setup.en.md)

## Community and license

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- Released under the [Apache License 2.0](LICENSE).
