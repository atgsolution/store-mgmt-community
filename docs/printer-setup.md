[Tiếng Việt](printer-setup.md) | [English](printer-setup.en.md)

# Kiến trúc in bill nhiệt

## 1. Hai cách in

Store MGMT cung cấp hai cách in:

| Cách in | Cách tạo bill | Kết nối | Unicode |
|---|---|---|---|
| In qua trình duyệt | Bố cục HTML/CSS dành cho in | Hệ thống in và driver của thiết bị | Đầy đủ |
| In USB trực tiếp | Chuỗi lệnh ESC/POS | WebUSB | Chuyển về ký tự ASCII |

In qua trình duyệt cho kết quả gần với bản xem trước. In USB trực tiếp nhanh hơn và không mở hộp thoại in. Trình duyệt và ESC/POS xử lý font khác nhau nên hai bản in có thể không giống tuyệt đối.

## 2. In qua trình duyệt

Khi in qua trình duyệt, ứng dụng dùng:

- khổ giấy 80 mm;
- vùng nội dung rộng 72 mm;
- lề trang bằng 0;
- nền trắng, chữ đen và loại bỏ phần giao diện ngoài bill;
- cỡ chữ đồng bộ với bản xem trước, giới hạn từ 10 đến 24.

Thiết lập driver khuyến nghị:

1. chọn đúng driver và khổ giấy 80 mm;
2. đặt tỷ lệ 100%;
3. chọn lề None hoặc Minimum;
4. tắt tiêu đề và chân trang của trình duyệt;
5. chỉnh độ đậm tại driver hoặc firmware nếu bản in nhạt.

Kết quả cuối cùng phụ thuộc vào vùng in của driver. Cấu hình sai khổ giấy có thể làm mất mép dù bản xem trước đúng.

## 3. Quy cách in USB trực tiếp

In USB khởi tạo máy bằng ESC/POS, chọn Font A của máy in ở kích thước chuẩn và dựng bill trên lưới cố định 48 cột. Nội dung dài được tự xuống dòng; cuối bill được đẩy thêm bốn dòng trước lệnh partial cut.

Nút chỉnh cỡ chữ chỉ áp dụng cho bản xem trước và in qua trình duyệt. In USB luôn dùng cấu hình cố định để tránh firmware tự phóng chữ hoặc làm tràn chiều ngang.

Nội dung tiếng Việt có dấu được chuyển thành không dấu trước khi gửi vì bảng mã ESC/POS khác nhau giữa các dòng máy. Bản xem trước và in qua trình duyệt vẫn giữ UTF-8 đầy đủ.

## 4. Điều kiện tương thích

In USB trực tiếp yêu cầu:

- Chrome hỗ trợ WebUSB;
- trang chạy qua HTTPS hoặc localhost;
- máy in có BULK OUT endpoint và hiểu ESC/POS;
- người dùng cấp quyền qua hộp chọn thiết bị;
- không có ứng dụng khác đang sử dụng máy in qua USB.

Trên máy tính bảng, có thể dùng nút in qua trình duyệt khi hệ điều hành đã kết nối và nhận máy in. In USB trực tiếp chỉ hoạt động khi trình duyệt hỗ trợ WebUSB và máy in hiểu ESC/POS; nếu không, cần print bridge hoặc native app.

## 5. Chẩn đoán

| Hiện tượng | Nội dung cần kiểm tra trước |
|---|---|
| Không mở hộp chọn thiết bị | Trang không dùng HTTPS/localhost hoặc trình duyệt không hỗ trợ WebUSB |
| Không mở được thiết bị | iPOS hoặc ứng dụng khác đang sử dụng máy in qua USB |
| Truyền dữ liệu thất bại | Không có BULK OUT endpoint hoặc firmware không hiểu ESC/POS |
| Mất mép phải | Sai khổ giấy, firmware tự phóng hoặc máy dùng cấu hình 58 mm |
| Chữ nhạt | Độ đậm nhiệt, nguồn điện, đầu in hoặc chất lượng giấy |
| Chữ Việt lỗi | Bảng mã không tương thích; dùng bản không dấu hoặc in qua trình duyệt |
| Mất phần cuối bill | Cơ chế đẩy giấy hoặc dao cắt khác chuẩn; cần tăng số dòng đẩy giấy |

## 6. Quy định vận hành

Mỗi thiết bị bán hàng nên in thử một bill mẫu và giữ nguyên cấu hình đã kiểm tra. Driver và firmware không được đóng gói trong ứng dụng web; chỉ sử dụng bộ cài từ nhà sản xuất hoặc nhà phân phối đáng tin cậy.
