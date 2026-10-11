# Kết quả kiểm thử trước phát hành

Ngày kiểm tra: 11/10/2026. Node.js 24.21.0. Không chỉnh sửa project ứng dụng.

| Kiểm tra | Windows | Ubuntu/WSL (bản sao MCP riêng trên filesystem Linux) |
| --- | --- | --- |
| Build, lint, typecheck | Đạt | Đạt |
| Tests | 13/13 đạt | 11 đạt, 2 test riêng Windows skip, 0 lỗi |
| Cài tarball, chạy bin --help | Đạt | Đạt |
| MCP handshake/list/read/readonly guard từ package đã cài | Đạt | Đạt |

npm audit gồm dependencies phát triển: 0 lỗ hổng được báo cáo tại thời điểm kiểm tra.
Không coi audit hay tests là bằng chứng không có mọi lỗ hổng.

## Phạm vi tests

- MCP client SDK thật: stdio, Streamable HTTP, handshake, tools/list và cả 9 tools.
- Traversal, UNC/ADS/device paths, secret paths, junction/symlink/hardlink, strict schema.
- Workspace isolation, mặc định readonly, verification tắt; shell executable bị từ chối.
- Create/replace/patch, hash conflict, token replay/expiry, xung đột tạo file.
- Patch không tự dịch vị trí; tọa độ nhất quán, multi-hunk, insertion và no-newline EOF.
- UTF-8 không hợp lệ bị từ chối trước ghi; BOM, CRLF và Unicode hợp lệ giữ nguyên bytes.
- Thay nội dung giữ inode/mode/uid/gid và truncate đúng độ dài. Linux kiểm tra mode 0750.
- Deadline đọc/tìm source; timeout giải phóng queue, traversal hết hạn fail closed.
- Git diff staged/unstaged; task timeout/output limit; Host/Origin/bearer checks.
- PowerShell startup và ánh xạ WSL runtime trên Windows.

Fixtures chỉ nằm trong .test-runs/.release-check của project MCP hoặc bản sao MCP
riêng dùng để test Linux. Không chạy lint/test/build của bất kỳ ứng dụng nào.
Smoke check readonly trên một workspace WSL thật đã đọc package.json, xem cấu trúc,
lấy Git diff bằng Git Ubuntu thành công; ghi và verification bị từ chối. Source
và diff không được in vào báo cáo. Cấu hình workspace thật không nằm trong release.

## Kiểm tra phát hành

- MIT license; SECURITY.md, CONTRIBUTING.md, README dùng ví dụ chung.
- Tarball có runtime dist, config mẫu, script startup, README tiếng Việt/Anh, SECURITY và LICENSE.
- Không chứa config thật, tests fixtures, tunnel profile, credentials hay node_modules.
- Bin có shebang; cài local và gọi MCP thành công, không phụ thuộc source tree.
- CI Windows/Linux chạy trên GitHub cho mỗi lần push và pull request. Xem [kết quả CI](https://github.com/thminh176/mcp-project-assistant/actions/workflows/ci.yml).
- Repository đã được công khai trên [GitHub](https://github.com/thminh176/mcp-project-assistant) ngày 12/10/2026. Chưa publish npm hay xác nhận package name khả dụng.
- Không cấu hình tunnel; chưa kiểm thử ChatGPT end-to-end. Tunnel đã tạo theo thông
  tin người dùng không được coi là kết nối server đã xác minh.

Giới hạn còn lại được ghi trong SECURITY.md: không có sandbox OS cho verification,
không phát hiện secret nhúng tùy ý, không chống hoàn toàn filesystem races bên ngoài,
write không crash-atomic, chưa bảo đảm kill subprocess Linux/WSL. Metadata tests
xác minh file identity/POSIX mode; không kiểm thử mọi custom Windows ACL/xattr.
