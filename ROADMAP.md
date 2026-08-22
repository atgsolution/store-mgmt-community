[English](#english) | [Tiếng Việt](#tiếng-việt)

# Store MGMT Community Edition Roadmap

This roadmap communicates direction rather than fixed delivery dates. Stable behavior remains documented in the release notes; proposed work is discussed publicly before implementation.

## English

### Current foundation

- Single-store sales and order management with shared PostgreSQL data.
- Staff/Admin authorization, seven-day sessions, audit logs, and immutable paid orders.
- Product, category, tag, payment, revenue, and opening/closing cash workflows.
- Vietnamese and English interfaces and receipts.
- Browser printing and direct WebUSB ESC/POS output for 80 mm thermal printers.
- Docker Compose deployment with operational, archive, and compressed historical data layers.

### Near-term priorities

- Publish a community-maintained 80 mm printer compatibility matrix.
- Improve deployment diagnostics and documented HTTPS reverse-proxy profiles.
- Extend backup, restore, and disaster-recovery verification guidance.
- Improve keyboard, touch, accessibility, and responsive-layout coverage.
- Refine receipt templates and printer-specific calibration options.
- Expand automated upgrade and hardware compatibility checks.

### Community proposals

Feature proposals are evaluated against the single-store scope, operational simplicity, data safety, and maintainability. Open a [Discussion](https://github.com/atgsolution/store-mgmt-community/discussions) before implementing a substantial change.

### Current scope boundary

Multi-store operation, multi-tenant SaaS hosting, electronic invoicing, and accounting integrations are not part of the current Community Edition scope.

## Tiếng Việt

Roadmap này thể hiện định hướng, không cam kết ngày phát hành cố định. Chức năng ổn định được ghi trong release notes; đề xuất mới sẽ được thảo luận công khai trước khi triển khai.

### Nền tảng hiện tại

- Bán hàng và quản lý đơn cho một cửa hàng, dùng chung dữ liệu PostgreSQL.
- Phân quyền Staff/Admin, phiên đăng nhập 7 ngày, audit log và khóa đơn đã thanh toán.
- Quản lý món, loại món, tag, thanh toán, doanh thu và tiền đầu/cuối ca.
- Giao diện và bill bằng tiếng Việt hoặc tiếng Anh.
- In qua trình duyệt hoặc WebUSB ESC/POS trực tiếp tới máy in nhiệt 80 mm.
- Triển khai Docker Compose với database vận hành, archive database và dữ liệu lịch sử nén.

### Ưu tiên gần hạn

- Xây dựng bảng tương thích máy in 80 mm do cộng đồng đóng góp.
- Bổ sung chẩn đoán triển khai và cấu hình mẫu cho HTTPS reverse proxy.
- Hoàn thiện hướng dẫn kiểm tra backup, restore và disaster recovery.
- Cải thiện thao tác bàn phím, cảm ứng, accessibility và responsive layout.
- Tinh chỉnh mẫu bill và tùy chọn hiệu chỉnh theo từng máy in.
- Mở rộng kiểm tra tự động cho quy trình nâng cấp và tương thích phần cứng.

### Đề xuất từ cộng đồng

Đề xuất tính năng được đánh giá theo phạm vi một cửa hàng, độ đơn giản khi vận hành, an toàn dữ liệu và khả năng bảo trì. Hãy mở [Discussion](https://github.com/atgsolution/store-mgmt-community/discussions) trước khi triển khai thay đổi lớn.

### Giới hạn phạm vi hiện tại

Multi-store, multi-tenant SaaS, hóa đơn điện tử và tích hợp kế toán chưa thuộc phạm vi hiện tại của Community Edition.
