# Contributing / Đóng góp

Store MGMT welcomes focused bug fixes, documentation improvements, hardware compatibility reports, and features that fit the single-store scope.

Store MGMT chào đón các bản sửa lỗi, cải thiện tài liệu, báo cáo tương thích phần cứng và tính năng phù hợp với phạm vi một cửa hàng.

## Before opening a change / Trước khi thực hiện thay đổi

- Search existing issues and discussions.
- Open an issue before large behavioral, database, or architecture changes.
- Do not include customer data, credentials, database dumps, or proprietary printer drivers.
- Keep Vietnamese and English user-facing documentation synchronized.

- Kiểm tra issue và discussion đã có trước khi tạo mới.
- Trao đổi bằng issue trước khi thay đổi lớn về nghiệp vụ, database hoặc kiến trúc.
- Không đưa dữ liệu khách hàng, thông tin đăng nhập, database dump hoặc driver độc quyền vào repo.
- Đồng bộ tài liệu tiếng Việt và tiếng Anh khi thay đổi nội dung dành cho người dùng.

## Development / Phát triển

Requirements: Node.js 22, npm, Docker Engine, and Docker Compose v2.

```bash
npm ci
npm run typecheck
npm run build
```

Run the complete stack with isolated development data:

```bash
bash scripts/setup-linux.sh
docker compose up -d --build
```

Never run `docker compose down -v` against a deployment whose data must be retained.

## Pull requests

A pull request should:

- address one coherent change;
- explain behavior and data impact;
- include migration notes when the schema changes;
- preserve backward-compatible upgrades where practical;
- include relevant tests or reproducible verification;
- pass type checking, production build, and Docker smoke checks.

Pull request cần tập trung vào một thay đổi, mô tả ảnh hưởng đến nghiệp vụ và dữ liệu, bổ sung migration khi cần, kèm kiểm tra phù hợp và vượt qua toàn bộ CI.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

Không báo cáo lỗ hổng qua issue công khai. Xem [SECURITY.md](SECURITY.md).
