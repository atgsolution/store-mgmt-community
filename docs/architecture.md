[Tiếng Việt](architecture.md) | [English](architecture.en.md)

# Kiến trúc phần mềm

## 1. Phạm vi

Store MGMT là hệ thống bán hàng self-hosted cho một cửa hàng trên mỗi bản cài đặt. Thiết kế ưu tiên tính đúng đắn của giao dịch, dữ liệu nhất quán giữa nhiều phiên và khả năng vận hành độc lập.

Các thuộc tính chất lượng chính:

- **Nhất quán:** API là nguồn dữ liệu chính thức.
- **Toàn vẹn:** số tiền và quyền chuyển trạng thái được kiểm tra tại máy chủ.
- **Khả năng vận hành:** toàn bộ hệ thống được đóng gói bằng Docker Compose.
- **Theo dõi thay đổi:** thao tác quản trị và thay đổi trạng thái quan trọng được ghi vào audit log.
- **Quyền sở hữu dữ liệu:** dữ liệu nằm trong hạ tầng của đơn vị triển khai.

## 2. Sơ đồ thành phần

```text
Trình duyệt trên máy tính / máy tính bảng
             │ HTTPS
             ▼
           Nginx
           ├── Giao diện tĩnh
           └── /api/* ─────────────► API Node.js
                                          │
                             ┌────────────┴────────────┐
                             ▼                         ▼
                       Hot PostgreSQL          Archive PostgreSQL
                             │                         ▲
                             └──── Archive worker ─────┘
                                          │
                                          ▼
                                      Cold archive
```

## 3. Trách nhiệm

| Thành phần | Trách nhiệm |
|---|---|
| React/Vite | Giao diện, trạng thái tương tác, xem trước bill và WebUSB |
| Nginx | Phục vụ frontend, chuyển tiếp API và thiết lập security headers |
| API Node.js | Xác thực, phân quyền, nghiệp vụ, báo cáo và audit log |
| Hot PostgreSQL | Danh mục, cấu hình, phiên, audit log và giao dịch hiện hành |
| Archive PostgreSQL | Lịch sử giao dịch nằm ngoài thời hạn của hot database |
| Archive worker | Chuyển dữ liệu cũ sang archive database và tạo cold archive |

## 4. Mô hình nhất quán

- Trình duyệt gửi yêu cầu và dữ liệu đầu vào; API tính lại tổng tiền từ từng dòng hàng trước khi ghi.
- Các thay đổi liên quan nhiều bảng được thực hiện trong transaction PostgreSQL.
- Đơn đã `PAID` không được sửa trong quy trình thông thường; chỉ Quản trị viên được xóa và thao tác phải có audit log.
- Mọi phiên trong cùng bản cài đặt dùng chung `STORE_ID` và cùng nguồn dữ liệu.
- LocalStorage chỉ lưu lựa chọn riêng của thiết bị như giao diện và ngôn ngữ; không lưu dữ liệu nghiệp vụ chính thức.

## 5. Vòng đời dữ liệu

Dữ liệu đang hoạt động được giữ trong hot database. Đơn đã thanh toán và audit log quá 60 ngày được chuyển sang archive database. Sau một năm, dữ liệu được nén theo tháng thành cold archive.

Archive worker chạy nền và không tham gia trực tiếp vào thao tác bán hàng. Nếu worker lỗi, việc bán hàng vẫn hoạt động nhưng dữ liệu cũ sẽ chưa được chuyển sang archive database.

## 6. Bảo mật

- Xác thực, phân quyền và các điều kiện nghiệp vụ được thực thi tại API.
- Mật khẩu được hash bằng scrypt; phiên đăng nhập có thời hạn và giới hạn số lượng.
- Frontend không chứa mật khẩu hoặc thông tin kết nối database.
- Database chỉ mở trong mạng nội bộ hoặc localhost; truy cập ứng dụng qua HTTPS reverse proxy.

## 7. Triển khai và sự cố

Frontend và API không lưu dữ liệu nghiệp vụ trực tiếp; dữ liệu nằm trong PostgreSQL và Docker volumes. Migration chạy trước khi API khởi động.

Docker Compose hiện chạy trên một máy chủ và chưa có high availability. Nếu hot database ngừng hoạt động, ứng dụng không thể ghi dữ liệu. Nếu archive database ngừng hoạt động, giao dịch hiện tại vẫn giữ được nhưng lịch sử cũ có thể không truy cập được.

## 8. Nguyên tắc mở rộng

- Thay đổi cấu trúc dữ liệu phải tương thích với phiên bản đang chuyển đổi.
- Không dùng LocalStorage làm dữ liệu nghiệp vụ hoặc để giả lập nhiều cửa hàng.
- Multi-store và multi-tenant cần thiết kế riêng về cách ly dữ liệu, phân quyền và migration.
