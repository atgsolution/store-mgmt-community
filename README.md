[English](README.md) | [Tiếng Việt](README.vi.md)

# Store MGMT Community Edition

[![Docker smoke test](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml/badge.svg)](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

**Self-hosted POS and store management for small shops, cafés, and restaurants.**

Store MGMT Community Edition combines browser-based sales, menu and order management, revenue reporting, and 80 mm receipt printing with centralized PostgreSQL data on infrastructure you control.

![Store MGMT Community Edition product preview](docs/assets/media/product-preview.gif)

**[Watch the full product video](https://github.com/atgsolution/store-mgmt-community/releases/download/v1.0.1/store-mgmt-guide.mp4)** · [Latest release](https://github.com/atgsolution/store-mgmt-community/releases/latest) · [Roadmap](ROADMAP.md) · [Discussions](https://github.com/atgsolution/store-mgmt-community/discussions)

## Quick Start

Requires a Linux host with Docker Engine, Docker Compose v2, Git, and OpenSSL.

```bash
git clone https://github.com/atgsolution/store-mgmt-community.git
cd store-mgmt-community
bash scripts/setup-linux.sh
docker compose up -d --build
```

Open `http://localhost:6086` on the server or `http://<server-address>:6086` from another device on the same network. The setup script prompts for `admin` and `staff` passwords, generates unique database secrets, and stores only scrypt password hashes. There are no public default passwords.

## Who is this for?

- Independent shops that need a simple browser-based sales and order workflow.
- Cafés and restaurants that use tables, dine-in or takeaway service, deposits, discounts, and 80 mm receipts.
- Small teams that want shared operational data across computers or tablets without adopting a hosted SaaS platform.
- Operators comfortable maintaining a Linux server, Docker deployment, backups, and HTTPS.

If you require multi-store operation, regulated payment or fiscal integrations, ingredient-level inventory, or a kitchen display system, review the [current limits](#current-limits) before deploying.

## Core capabilities

- Touch-friendly sales workflow for computers and tablets.
- Product, category, tag, price, and availability management.
- Table, service type, deposit, discount, payment-method, and order-note management.
- Staff/Admin authorization, read-only paid orders, and administrative audit logs.
- Daily, monthly, and yearly revenue; payment mix; top products; opening and closing cash.
- 80 mm thermal receipts through the browser print dialog or direct WebUSB ESC/POS.
- Vietnamese and English interfaces and receipts with UTF-8 application data.
- Shared PostgreSQL data for authenticated sessions on multiple devices.

## Product tour

| Sales and order management | 80 mm receipt preview |
|---|---|
| ![Store MGMT sales screen](docs/assets/screenshots/sales-overview.png) | ![Store MGMT receipt preview](docs/assets/screenshots/receipt-preview-live.png) |
| Menu and pricing | Category and tag management |
| ![Store MGMT menu and pricing screen](docs/assets/screenshots/menu-and-prices.png) | ![Store MGMT category and tag management](docs/assets/screenshots/categories-and-tags-live.png) |
| Order history and receipt reprinting | Revenue analytics |
| ![Store MGMT order history screen](docs/assets/screenshots/order-history.png) | ![Store MGMT revenue analytics screen](docs/assets/screenshots/revenue-analytics.png) |

## Current limits

- One store per deployment; multi-store and multi-tenant operation are not implemented.
- No card-terminal integration or payment processing. The application records payment methods only.
- No fiscalization, e-invoicing, or accounting integration.
- No recipe/BOM-based inventory deduction.
- No kitchen display system (KDS).

## Deployment profile

| Property | Design |
|---|---|
| Scope | One store per deployment |
| Source of truth | Shared PostgreSQL data for all authenticated sessions |
| Retention | 60-day operational database, archive database, and compressed long-term archive |
| Sessions | Up to 10 sessions per account with a seven-day lifetime |
| Deployment | Docker Compose with separate web, API, archive worker, and database services |
| Printing | Browser print dialog or direct WebUSB ESC/POS |

## Account operations

### Change a password

Sign in as `admin`, open **Users**, enter and confirm the new password for `admin` or `staff`, then select **Change password**. Changing a password revokes the account's other active sessions.

If no Admin session is available, reset the account from the project directory while the containers are running:

```bash
bash scripts/reset-password.sh admin
# or
bash scripts/reset-password.sh staff
```

The reset changes only the selected account, revokes its sessions, and writes an audit entry. It does not remove orders, catalog data, or store settings.

## Upgrades

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
```

Recreating containers preserves Docker data volumes. Never run `docker compose down -v` on a deployment whose data must be retained.

## Backup and restore

```bash
docker compose exec -T hot-db \
  pg_dump -U store_mgmt -d store_mgmt_hot > hot-backup.sql

docker compose exec -T archive-db \
  pg_dump -U store_mgmt -d store_mgmt_archive > archive-backup.sql
```

A complete recovery set includes both database dumps and the long-term archive volume. Treat a backup as valid only after a successful restore test; see the [data architecture](docs/database.en.md) for retention details.

## Security

- Account passwords use scrypt with random salts.
- Production deployments should run behind an HTTPS reverse proxy with `COOKIE_SECURE=true`.
- Authorization and business rules are enforced by the API.
- Report security issues through the [security policy](SECURITY.md), not a public issue.

## Project transparency

Store MGMT Community Edition is built and maintained by the project maintainer with significant assistance from OpenAI Codex. The maintainer remains responsible for architecture, code review, testing, security decisions, and releases.

## Field feedback

Real deployment feedback is more useful than generic feature requests. Please use [Discussions](https://github.com/atgsolution/store-mgmt-community/discussions) for operational feedback and [Issues](https://github.com/atgsolution/store-mgmt-community/issues) for reproducible defects, especially around:

- receipt-printer model, connection type, browser, and print output;
- behavior across multiple computers or tablets using the same deployment;
- backup and restore procedures that have been tested in practice;
- missing sales, order, shift, or reporting workflows.

Include the deployment version and environment, but never post credentials, `.env` files, or database dumps.

## Documentation

- [Software architecture](docs/architecture.en.md)
- [Data architecture and lifecycle](docs/database.en.md)
- [Thermal printing architecture](docs/printer-setup.en.md)
- [Project roadmap](ROADMAP.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

Released under the [Apache License 2.0](LICENSE).
