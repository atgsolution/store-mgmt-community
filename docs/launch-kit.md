# Store MGMT Community Edition — Launch Kit

Maintainer-facing copy and assets for the public Community Edition launch.

## Canonical links

- Repository: https://github.com/atgsolution/store-mgmt-community
- Latest release: https://github.com/atgsolution/store-mgmt-community/releases/latest
- Discussions: https://github.com/atgsolution/store-mgmt-community/discussions
- Roadmap: https://github.com/atgsolution/store-mgmt-community/blob/main/ROADMAP.md

## Assets

- Social preview: [`docs/assets/social-preview.jpg`](assets/social-preview.jpg), 1280×640.
- Product screenshots: [`docs/assets/screenshots/`](assets/screenshots/).
- Demo video: [`store-mgmt-guide.mp4`](https://github.com/atgsolution/store-mgmt-community/releases/download/v1.0.1/store-mgmt-guide.mp4), published as a `v1.0.1` release asset.

## Positioning

### Tiếng Việt

Store MGMT Community Edition là nền tảng bán hàng self-hosted miễn phí cho một cửa hàng, hỗ trợ quản lý đơn, doanh thu, dữ liệu PostgreSQL dùng chung và in bill nhiệt 80 mm ngay từ trình duyệt.

### English

Store MGMT Community Edition is a free, bilingual, self-hosted POS for single-store teams, with shared PostgreSQL data and browser or direct WebUSB printing for 80 mm thermal receipts.

## Short launch post — Tiếng Việt

Tôi vừa phát hành Store MGMT Community Edition — một app bán hàng self-hosted miễn phí cho cửa hàng nhỏ.

App hỗ trợ chọn món, quản lý đơn theo bàn, cọc/giảm giá/thanh toán, doanh thu ngày–tháng–năm, phân quyền Staff/Admin và in bill nhiệt 80 mm qua trình duyệt hoặc WebUSB. Dữ liệu được lưu tập trung trên PostgreSQL và triển khai bằng Docker Compose.

Repo có hướng dẫn tiếng Việt/Anh, screenshot và bản release chạy được. Tôi rất mong nhận phản hồi thực tế về quy trình bán hàng và khả năng tương thích máy in.

https://github.com/atgsolution/store-mgmt-community

## Short launch post — English

I have released Store MGMT Community Edition, a free and bilingual self-hosted POS for single-store teams.

It covers touch-friendly sales, table orders, deposits, discounts, payments, revenue reporting, Staff/Admin access, and 80 mm thermal receipt printing through the browser or direct WebUSB ESC/POS. Shared operational data runs on PostgreSQL and the complete stack deploys with Docker Compose.

The repository includes English/Vietnamese documentation, screenshots, and a tested release. Feedback from store operators, self-hosters, and receipt-printer users is welcome.

https://github.com/atgsolution/store-mgmt-community

## Show HN

**Title**

`Show HN: Store MGMT – A bilingual self-hosted POS with WebUSB receipt printing`

**Opening comment**

I built Store MGMT after working through a real single-store receipt workflow: touch-based ordering, shared sessions, paid-order locking, revenue reporting, and reliable 80 mm printing from computers and tablets.

The project is React/TypeScript with an Express API, PostgreSQL, Docker Compose, browser printing, and direct WebUSB ESC/POS support. It is intentionally scoped to one store per deployment so the operational model remains understandable and self-hostable.

The Community Edition is Apache-2.0, bilingual in Vietnamese and English, and includes a complete Linux setup path. I would especially value feedback on deployment clarity, printer compatibility, and the boundaries of the single-store model.

## Product Hunt

- **Name:** Store MGMT Community Edition
- **Tagline:** Self-hosted POS with bilingual 80 mm receipt printing
- **Short description:** A free single-store POS with shared PostgreSQL data, revenue reporting, Staff/Admin access, and browser or WebUSB thermal printing.
- **Topics:** Open Source, SaaS Alternatives, Developer Tools, Small Business, Productivity

**Maker comment**

Store MGMT started as a practical replacement for a locked-in store billing workflow. The goal is not to become another multi-tenant SaaS platform; it is to provide a focused, inspectable deployment that a single store can run on its own infrastructure.

The Community Edition includes the full sales workflow, centralized PostgreSQL data, audit logs, revenue reporting, bilingual receipts, and two printing paths for 80 mm thermal printers. The repository is public under Apache-2.0, and feedback from real operators and self-hosters will directly shape the compatibility roadmap.

## Launch checklist

- [ ] Upload `docs/assets/social-preview.jpg` as the GitHub social preview.
- [ ] Pin the repository on the maintainer's GitHub profile.
- [ ] Attach the final demo video to launch posts.
- [ ] Publish a GitHub Discussion announcement.
- [ ] Post the Vietnamese version to relevant store-owner and developer communities.
- [ ] Post the English version to relevant open-source and self-hosted communities.
- [ ] Publish Show HN only when the project can be tried without additional explanation.
- [ ] Publish Product Hunt with the video, screenshots, and maker comment ready.
- [ ] Monitor GitHub Insights → Traffic and answer issues or Discussions promptly.
