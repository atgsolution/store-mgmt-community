[Tiếng Việt](README.md) | [English](README.en.md)

# Store MGMT Community Edition

[![Docker smoke test](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml/badge.svg)](https://github.com/atgsolution/store-mgmt-community/actions/workflows/docker-smoke.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

**Nền tảng bán hàng và quản lý cửa hàng self-hosted.**

Store MGMT Community Edition là phiên bản miễn phí dành cho cộng đồng, phù hợp với cửa hàng cần quản lý bán hàng và dữ liệu tập trung trên hệ thống riêng.

## Chức năng

- Bán hàng trên máy tính hoặc máy tính bảng.
- Quản lý món, loại món, nhãn, giá bán và trạng thái kinh doanh.
- Quản lý đơn theo bàn, hình thức phục vụ, tiền cọc, giảm giá và thanh toán.
- Phân quyền Nhân viên/Quản trị viên, khóa đơn đã thanh toán và ghi audit log.
- Báo cáo doanh thu ngày, tháng, năm; phương thức thanh toán; món bán chạy; tiền đầu và cuối ca.
- In bill nhiệt 80 mm ngay trên trình duyệt khi thiết bị đã kết nối và nhận máy in; hỗ trợ WebUSB ESC/POS.
- Giao diện và bill bằng tiếng Việt hoặc tiếng Anh; dữ liệu sử dụng UTF-8.

## Đặc tính hệ thống

| Thuộc tính | Thiết kế |
|---|---|
| Phạm vi | Một cửa hàng trên mỗi bản cài đặt |
| Nguồn dữ liệu | PostgreSQL dùng chung cho mọi phiên đăng nhập |
| Lưu trữ | Hot database 60 ngày, archive database và cold archive |
| Phiên đăng nhập | Tối đa 10 phiên cho mỗi tài khoản, thời hạn 7 ngày |
| Triển khai | Docker Compose gồm frontend, API, archive worker và PostgreSQL |
| Máy in | Hộp thoại in của trình duyệt hoặc WebUSB ESC/POS |

## Cài đặt trên Linux

Yêu cầu Docker Engine, Docker Compose v2, Git và OpenSSL.

```bash
git clone https://github.com/atgsolution/store-mgmt-community.git
cd store-mgmt-community
bash scripts/setup-linux.sh

docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Ứng dụng mặc định chạy tại `http://<địa-chỉ-máy-chủ>:6086`. Điểm kiểm tra trạng thái là `/healthz`.

Tài khoản khởi tạo:

| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Quản trị viên | `admin` | Chọn trong lúc setup |
| Nhân viên | `staff` | Chọn trong lúc setup |

Script setup tạo mật khẩu database ngẫu nhiên và chỉ lưu hash scrypt của mật khẩu tài khoản.

## Cập nhật

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
```

Việc tạo lại các dịch vụ Docker không xóa các vùng dữ liệu. Không chạy `docker compose down -v` trên hệ thống có dữ liệu cần giữ.

## Sao lưu

```bash
docker compose exec -T hot-db \
  pg_dump -U store_mgmt -d store_mgmt_hot > hot-backup.sql

docker compose exec -T archive-db \
  pg_dump -U store_mgmt -d store_mgmt_archive > archive-backup.sql
```

## Bảo mật

- Mật khẩu dùng scrypt với salt ngẫu nhiên; đổi mật khẩu sẽ thu hồi các phiên còn lại.
- Môi trường thực tế phải dùng HTTPS reverse proxy và bật `COOKIE_SECURE=true`.
- Quyền truy cập và quy tắc nghiệp vụ được thực thi tại API.

## Giới hạn

Phiên bản Cộng đồng hiện phục vụ một cửa hàng trên mỗi bản cài đặt. Multi-store, multi-tenant SaaS, hóa đơn điện tử và tích hợp kế toán chưa thuộc phạm vi hiện tại.

## Tài liệu

- [Kiến trúc phần mềm](docs/architecture.md)
- [Kiến trúc và vòng đời dữ liệu](docs/database.md)
- [Kiến trúc in bill nhiệt](docs/printer-setup.md)

## Cộng đồng và giấy phép

- [Hướng dẫn đóng góp](CONTRIBUTING.md)
- [Chính sách bảo mật](SECURITY.md)
- [Quy tắc cộng đồng](CODE_OF_CONDUCT.md)
- Phát hành theo [Apache License 2.0](LICENSE).
