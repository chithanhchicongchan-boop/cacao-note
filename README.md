# CACAO NOTE — Website son dưỡng + lời nhắn bí mật

**Phiên bản:** 1.0 · Bản mẫu học tập có thể triển khai bằng **Cloudflare Workers + D1**.

## 1. Đã có những gì?

- Giao diện tiếng Việt, responsive cho điện thoại; tông kem – nâu cacao – hồng dịu.
- **Mỗi thỏi son: 1 QR riêng + 1 MK1 riêng.** MK1 được in trên son hoặc thẻ đi kèm.
- Người mua quét QR, nhập MK1, viết lời nhắn (tối đa 2.200 ký tự), thêm tối đa **3 ảnh**, thêm **1 tệp âm thanh** (MP3/M4A/OGG/WebM, tối đa khoảng 2 MB) hoặc **ghi âm ngắn 30 giây** trên trình duyệt.
- Người mua tự tạo **MK2** (tối thiểu 12 ký tự). Tất cả lời nhắn, ảnh và âm thanh được mã hóa **trên thiết bị** bằng AES-GCM; khóa được dẫn xuất từ MK2 bằng PBKDF2-SHA256 (400.000 vòng).
- Máy chủ chỉ lưu **bản mã**, salt và IV, **không nhận MK2**. Người nhận nhập MK1 và MK2 để mở trên máy của họ.
- Sau khi người mua hoàn tất, lời nhắn chuyển sang trạng thái **locked**, không thể dùng MK1 để ghi đè.
- Trang `/admin` tạo QR và MK1 theo lô (ví dụ **8 sản phẩm**), in nhãn và tải CSV MK1 **một lần**.
- Không dùng SDK hay CDN bên ngoài: tạo mã QR ngay trong trình duyệt.

## 2. Xem thử ngay trên một thiết bị

Mở tệp `CACAO_NOTE_XEM_THU.html` (nằm ngoài ZIP, được gửi riêng). Bản demo sử dụng:

- **MK1 demo:** `CACAO-2026`
- **MK2:** bạn tự tạo, ít nhất 12 ký tự.

Bạn có thể gửi lời nhắn, ảnh và nhạc, khóa rồi mở lại **trên cùng một trình duyệt**. Dữ liệu demo nằm trong bộ nhớ/localStorage của trình duyệt và **không đồng bộ giữa điện thoại**. Một số trình duyệt chặn Web Crypto khi mở tệp HTML trực tiếp; nếu gặp lỗi hãy thử trong Chrome từ địa chỉ `https://` sau khi triển khai.

Đây **chỉ là bản xem thử**; **đừng in QR bản demo lên sản phẩm**.

## 3. Đưa website thật lên Cloudflare (lần đầu nên làm trên máy tính)

Cần tài khoản Cloudflare và Node.js 22+; không cần mua tên miền riêng (dùng `*.workers.dev`). Cloudflare có gói Workers + D1 miễn phí theo hạn mức. Chính sách có thể thay đổi: https://developers.cloudflare.com/d1/platform/limits/ và https://developers.cloudflare.com/workers/platform/limits/.

### Bước A: tải source và cài công cụ

Giải nén gói `CACAO_NOTE_CLOUDFLARE.zip`, mở Terminal/PowerShell **tại thư mục `cacao_note_cloudflare`**, chạy:

```bash
npm install
npx wrangler login
```

### Bước B: tạo cơ sở dữ liệu

```bash
npx wrangler d1 create cacao-note-db
```

Cloudflare sẽ trả về **database_id** dạng UUID. Mở file `wrangler.jsonc`, thay chuỗi:

```json
"database_id": "REPLACE_WITH_REAL_DATABASE_ID"
```

bằng UUID được cấp. **Nếu Wrangler tự thêm binding mới thì chỉ giữ một binding `DB` duy nhất**.

Tiếp tục:

```bash
npm run db:remote
```

Đây là bước tạo các bảng `gifts`, `gift_chunks`, `read_sessions` trên D1 thật.

### Bước C: đăng web và đặt mã quản trị

```bash
npm run deploy
npx wrangler secret put ADMIN_TOKEN
```

Khi chạy lệnh `secret put`, nhập **mã quản trị dài, ngẫu nhiên, ít nhất 24 ký tự** và lưu ở nơi riêng tư. Không ghi mã quản trị vào file source, không chia sẻ cho khách hàng.

Nếu được hỏi về cấu hình dịch vụ hoặc yêu cầu xác nhận triển khai lại, làm theo chỉ dẫn của Wrangler. Sau đó chạy `npm run deploy` lần nữa nếu cần.

Kết quả là địa chỉ ví dụ:

`https://cacao-note.<ten-tai-khoan>.workers.dev`

Phải kiểm tra `/api/health` hoạt động trước khi tạo QR:

`https://...workers.dev/api/health`

### Bước D: tạo 8 QR

- Mở `https://...workers.dev/admin`.
- Nhập mã quản trị `ADMIN_TOKEN` đã đặt.
- Chọn **8** sản phẩm → **Tạo mã QR & MK1**.
- **TẢI CSV NGAY**. MK1 chỉ hiện một lần, không thể lấy lại từ máy chủ (chỉ có bản băm).
- Bấm **In nhãn QR**. Kiểm tra mọi QR mở đúng trang trên điện thoại khác trước khi in lên son.
- Mỗi thỏi ghép đúng QR với MK1 tương ứng. Nếu MK1 in bên ngoài, người lạ nhìn thấy có thể chiếm quyền tạo lời nhắn **trước người mua**; nên che bằng tem cào hoặc đặt trong bao bì niêm phong.

## 4. Luồng người mua và người nhận

**Người mua:** QR riêng → nhập MK1 → viết lời nhắn/ảnh/âm thanh → đặt và nhập lại MK2 → xác nhận đã lưu MK2 → nhấn khóa. Một khi đã khóa, không sửa lại.

**Người nhận:** Quét QR đó → nhập MK1 trên son → nhập MK2 do người tặng nói riêng → đọc lời nhắn, xem ảnh, bấm phát âm thanh.

**Lưu ý:** MK1 in trên son là thông tin công khai và **không phải lớp bảo mật bí mật**. Việc giữ kín nội dung chủ yếu dựa vào MK2 và cơ chế mã hóa. Người mua quên MK2 sẽ **không mở lại được** lời nhắn.

## 5. Dung lượng và chi phí

Giới hạn bản mẫu: tối đa 3 ảnh (tự giảm kích thước), 1 tệp nhạc/ghi âm khoảng 2 MB, tổng dữ liệu văn bản + media trước mã hóa khoảng 5,5 MB. Dữ liệu mã hóa được chia thành các đoạn nhỏ và lưu trong D1; **không yêu cầu R2 hoặc thẻ thanh toán chỉ để sử dụng D1 ở mức miễn phí**. D1 Free giới hạn tối đa 500 MB cho mỗi cơ sở dữ liệu, 5 GB tổng bộ nhớ/tài khoản (theo tài liệu Cloudflare tháng 10/2026). Với 8 thỏi và file ngắn, thường đủ; không bảo đảm miễn phí mãi mãi.

## 6. Bảo mật và giới hạn cần biết

- Đây là **dự án thử nghiệm**, **chưa được kiểm toán bảo mật**. Dữ liệu riêng tư được mã hóa trên trình duyệt, nhưng một người kiểm soát máy chủ và **sửa JavaScript được phục vụ trong tương lai** có thể gây rủi ro đối với mật khẩu MK2. Vì vậy không cam kết người vận hành tuyệt đối không thể truy cập trong mọi tình huống.
- Chưa có **chức năng tự xóa nội dung, sao lưu phục hồi, chính sách lưu giữ cụ thể, chống spam hoàn chỉnh hoặc hỗ trợ khách hàng**. Cần bổ sung trước khi đưa vào sử dụng thương mại với thông tin cá nhân thực tế.
- D1 lưu dữ liệu trên máy chủ của Cloudflare; nội dung thư là bản mã. Tuy vậy các siêu dữ liệu như thời điểm tạo, trạng thái sản phẩm và lượt truy cập vẫn có thể được hệ thống ghi nhận.
- Mặc dù không phải gia hạn website hàng tháng như một số hosting miễn phí khác, gói Cloudflare miễn phí **không bảo đảm tồn tại vĩnh viễn**. Để lời nhắn không mất, phải giữ tài khoản, giám sát website và có kế hoạch sao lưu dữ liệu đã mã hóa.
- Người mua chỉ nên gửi **nhạc do mình sáng tác hoặc có quyền sử dụng**, không nên tải lên bản ghi có bản quyền khi chưa được phép.
- Son dưỡng handmade vẫn cần đáp ứng **quy định về an toàn và công bố mỹ phẩm** nếu bán thực tế. Website không thay thế việc kiểm định sản phẩm.

## 7. Tự kiểm tra API ở môi trường lập trình

Trong Node.js 22+, không cần phụ thuộc ngoài cho bài kiểm tra máy chủ:

```bash
node --no-warnings tests/worker.test.mjs
```

Test bao gồm: tạo sản phẩm, nhập MK1, mã hóa AES-GCM, tải dữ liệu, khóa, chặn ghi đè, lấy dữ liệu mã hóa, giải mã bằng MK2, từ chối truy cập chưa xác thực.

## 8. Cấu trúc dự án

```text
cacao_note_cloudflare/
├── wrangler.jsonc        # Worker + D1 + static assets
├── schema.sql            # Bảng lưu sản phẩm, bản mã, phiên đọc
├── src/worker.js         # API backend
├── public/index.html     # Website
├── public/style.css      # Thiết kế giao diện
├── public/app.js         # Mã hóa, form gửi, nhận, ghi âm, admin
├── public/qr.js          # QR cục bộ (Kazuhiko Arase / MIT)
├── package.json
├── tests/worker.test.mjs
└── README.md
```

**Không tự tạo QR bằng tên miền giả rồi in lên son.** Mã QR chính thức chỉ tạo sau khi site đã có địa chỉ công khai hoạt động.
