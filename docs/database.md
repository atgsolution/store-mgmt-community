[Tiếng Việt](database.md) | [English](database.en.md)

# Kiến trúc và vòng đời dữ liệu

## 1. Mô hình lưu trữ

PostgreSQL là nguồn dữ liệu chính thức. Dữ liệu được tổ chức theo cửa hàng, người dùng và phiên đăng nhập, danh mục món, đơn hàng, audit log và tiền mặt theo ngày.

Các điều kiện quan trọng được bảo vệ tại cơ sở dữ liệu và API:

- khóa chính dùng UUID; tên đăng nhập và mã đơn là duy nhất trong phạm vi cửa hàng;
- giá trị tiền dùng `numeric(12,2)` và không được âm;
- số lượng phải dương; vai trò, phương thức thanh toán và trạng thái đơn bị giới hạn bằng `CHECK`;
- mỗi dòng hàng lưu lại tên món và đơn giá tại thời điểm tạo đơn, vì vậy thay đổi menu không làm sai lịch sử;
- xóa đơn sẽ xóa các dòng hàng liên quan; xóa người dùng sẽ xóa các phiên của người đó.

Bảng `daily_cash_balances` dùng ngày kinh doanh làm khóa vì mỗi bản cài đặt chỉ phục vụ một cửa hàng.

## 2. Các tầng dữ liệu

| Tầng | Vai trò | Thời hạn mặc định |
|---|---|---|
| Hot database | Giao dịch hiện hành, danh mục, người dùng, phiên và truy vấn thường xuyên | 60 ngày |
| Archive database | Đơn đã thanh toán và audit log ngoài thời hạn của hot database | Từ 60 ngày |
| Cold archive | Tệp JSON Lines nén gzip theo tháng, kèm checksum SHA-256 | Từ 365 ngày |

Đơn `OPEN` luôn ở hot database. Báo cáo dài hạn kết hợp dữ liệu từ hot database và archive database.

## 3. Quy trình chuyển dữ liệu

Archive worker xử lý tối đa 500 đơn mỗi lô:

1. chọn đơn `PAID` theo `updated_at` và audit log theo `created_at`;
2. sao chép đơn, dòng hàng và audit log sang archive database trong một transaction;
3. đối chiếu số bản ghi và checksum SHA-256;
4. ghi kết quả lô vào `archive_batches`;
5. xóa bản nguồn khỏi hot database trong một transaction riêng.

Nếu worker bị gián đoạn, lô dữ liệu có thể chạy lại mà không tạo bản ghi trùng nhờ UUID và `ON CONFLICT DO NOTHING`.

Cold archive được nhóm theo tháng và ghi thành `.jsonl.gz`; kích thước và checksum được lưu trong `cold_archive_manifests`. Việc xóa dữ liệu nguồn bị tắt mặc định. Chỉ bật `COLD_ARCHIVE_DELETE_SOURCE=true` sau khi đã thử restore thành công.

## 4. Thiết kế truy vấn

Các truy vấn chính được hỗ trợ bằng chỉ mục ghép hoặc chỉ mục có điều kiện:

- lịch sử đơn: `(store_id, created_at DESC, id DESC)`;
- đơn cập nhật gần đây: `(store_id, updated_at DESC, id DESC)`;
- đơn đang mở: chỉ mục có điều kiện theo `store_id, status, updated_at`;
- đơn đủ điều kiện lưu trữ: chỉ mục có điều kiện cho trạng thái `PAID`;
- audit log theo thời gian: `(store_id, created_at DESC, id DESC)`;
- bộ lọc danh mục theo cửa hàng, trạng thái, loại món và tên;
- session hết hạn và danh sách cold archive theo tháng.

UUID được thêm vào thứ tự sắp xếp để phân trang ổn định khi nhiều bản ghi có cùng thời điểm.

## 5. Thay đổi cấu trúc

`server/migrate.mjs` áp dụng các tệp trong `db/migrations` theo thứ tự và ghi phiên bản vào `schema_migrations`. Cùng một tập thay đổi được áp dụng cho cả hai cơ sở dữ liệu trước khi API khởi động.

Migration production phải chạy lặp an toàn và không xóa dữ liệu ngoài kế hoạch. Thay đổi không tương thích cần chia thành ba bước: thêm cấu trúc mới, chuyển dữ liệu, rồi mới xóa cấu trúc cũ.

## 6. Sao lưu và phục hồi

Bộ backup đầy đủ gồm:

- file dump của hot database;
- file dump của archive database;
- volume cold archive;
- file cấu hình cần thiết để dựng lại hệ thống.

Chu kỳ backup quyết định lượng dữ liệu có thể mất khi xảy ra sự cố. Hãy restore thử trên môi trường riêng và đối chiếu dữ liệu; file backup chưa từng restore thành công chưa được xem là bản backup hợp lệ.
