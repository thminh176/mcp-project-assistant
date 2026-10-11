# mcp-project-assistant

MCP Server độc lập bằng TypeScript và SDK MCP chính thức v2. Giúp MCP clients
hiểu source, chuẩn bị prompt cho Codex local và sửa code khi người dùng yêu cầu.
Hỗ trợ Windows và workspace WSL. License MIT.

Mặc định chỉ đọc, không tự cấp quyền project, không tạo tunnel hay sửa cấu hình
client. Mỗi tiến trình chỉ phục vụ workspace được người vận hành chọn khi startup.

## Cài từ source

Yêu cầu Node.js 24+, npm; Git nếu dùng git_diff. Clone vào thư mục riêng:

```powershell
git clone https://github.com/thminh176/mcp-project-assistant.git
Set-Location mcp-project-assistant
npm.cmd ci
npm.cmd run build
Copy-Item config/workspaces.example.json config/workspaces.json
```

Sửa root tuyệt đối và denyPaths cho dữ liệu nhạy cảm thực tế. Cả hai workspace mẫu
đều writable=false, verification={}. denyPaths/protectedPaths nhận file hoặc
thư mục tương đối, không phải glob. Cấu hình thật không được commit.

```powershell
node dist/index.js --config config/workspaces.json --workspace project-a --transport stdio
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Mcp.ps1 -Workspace project-a
```

ExecutionPolicy Bypass chỉ áp dụng cho tiến trình này. Trên Linux dùng npm thay
npm.cmd; script PowerShell và runtime WSL dành cho Windows.

## Gói npm

Đã có bin và allowlist đóng gói. Chưa xác nhận đã publish lên npm; cài tarball local:

```powershell
npm.cmd pack
npm.cmd install -g ./mcp-project-assistant-1.0.0.tgz
mcp-project-assistant --help
mcp-project-assistant --config C:/MCP/config/workspaces.json --workspace project-a
```

Giữ cấu hình bên ngoài thư mục package được cài.

## MCP client local

Ví dụ client dùng mcpServers; thay đường dẫn bằng đường dẫn thật:

```json
{
  "mcpServers": {
    "project-a": {
      "command": "node",
      "args": ["C:/MCP/mcp-project-assistant/dist/index.js", "--config", "C:/MCP/config/workspaces.json", "--workspace", "project-a"]
    }
  }
}
```

Client khác chuyển cùng command/argv sang schema của nó. Hai workspace đồng thời
cần hai kết nối/tiến trình; không có tool đổi workspace. Cấu hình đổi cần restart.
Stdio stdout chỉ dành cho MCP; lỗi qua stderr.

## Streamable HTTP local

```powershell
$env:MCP_HTTP_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node dist/index.js --config config/workspaces.json --workspace project-a --transport http --port 8787
```

Host 127.0.0.1, endpoint http://127.0.0.1:8787/mcp. Client gửi Authorization:
Bearer <token>. Token tối thiểu 32 ký tự, không được server in ra. Host/Origin
được kiểm tra, request body tối đa 1 MiB. Không có OAuth/public HTTPS. Không mở
endpoint này ra Internet. Client cùng token chia sẻ workspace và preview state.

## Workspace WSL

Ví dụ root trong cấu hình JSON:

```json
{
  "workspaces": [{
    "id": "project-wsl",
    "root": "\\\\wsl.localhost\\Ubuntu\\home\\developer\\projects\\sample-project",
    "writable": false,
    "denyPaths": ["storage", "private", "backups"],
    "verification": {}
  }]
}
```

Git diff dùng /usr/bin/git bên distribution cấu hình qua wsl.exe --exec, không
qua shell hoặc sửa safe.directory toàn cục. Ubuntu cần Git và truy cập được.
UNC chỉ làm root cấu hình; tool vẫn chỉ nhận đường dẫn tương đối. Dùng maxFiles
20–100 qua WSL. Deadline đọc/tìm source là 10 giây; thu hẹp truy vấn khi timeout.

## Tools

| Tool | Công dụng |
| --- | --- |
| workspace_info | ID, writable và verification được phép |
| read_file | UTF-8 hợp lệ, số dòng, SHA-256; tối đa 512 KiB |
| project_structure | File an toàn; maxFiles mặc định 500, tối đa 2.000 |
| search_code | Chuỗi literal; tối đa 200 kết quả |
| analyze_dependencies | Dependency trực tiếp package.json, không dùng mạng |
| git_diff | Diff một file, staged hoặc unstaged |
| preview_edit | Create/replace/unified patch một file, trả diff/token |
| apply_edit | Token một lần, hết hạn 5 phút |
| run_verification | Lint/typecheck/test/build theo allowlist argv |

Traversal giới hạn 10.000 mục/12 cấp, báo truncated nếu chạm giới hạn. Timeout
trả lỗi. Analyzer chưa hỗ trợ dependency bắc cầu/Python/.NET. Git yêu cầu root
workspace bằng repo root; tắt external diff/textconv. File chưa tracked đọc qua
read_file. Secret trong source hoặc historical diff vẫn cần denyPaths của bạn.

## Chỉnh sửa

1. Người dùng yêu cầu thay đổi, người vận hành bật writable rồi restart.
2. Đọc file lấy SHA-256, preview_edit với expectedHash; tạo mới dùng mode=create.
3. Duyệt diff qua host rồi apply_edit bằng token khi đã được phép.
4. Kiểm tra diff và chạy verification đã allowlist nếu phù hợp.

Patch một file, tên khớp path (cho phép a/ và b/), context phải khớp tại dòng
khai báo, không tự tìm vị trí khác. Không có tool xóa file. Từ chối UTF-8 lỗi,
NUL và surrogate lỗi; giữ UTF-8 BOM. Token không chứng minh người dùng đã duyệt.

Thay nội dung ghi vào cùng file object để giữ Windows ACL/Linux mode/ownership.
Không crash-atomic: lỗi đĩa/crash có thể để lại nội dung dở. Dùng Git/backup và
tránh writer đồng thời. Hash không phải transaction liên tiến trình. File mới
wx không ghi đè. Token nằm trong bộ nhớ, mất khi restart.

## Verification

Mặc định không bật task. Client chỉ gửi tên task, không executable/argv/cwd.
Ví dụ runner đáng tin cậy nằm ngoài vùng chỉnh sửa:

```json
{
  "typecheck": {
    "executable": "C:/Program Files/nodejs/node.exe",
    "args": ["C:/MCP/trusted-verifiers/typescript/bin/tsc", "--noEmit"],
    "timeoutMs": 60000
  }
}
```

Windows nhận native executable tuyệt đối, chặn shell phổ biến; spawn shell=false.
Allowlist không phải sandbox OS: code có thể dùng mạng/đọc ngoài root/sinh artifacts.
Bảo vệ runner/config hoặc dùng OS account hạn chế/VM. Không cấu hình lệnh in secrets.
Environment con không kế thừa tùy ý API keys/tokens. Timeout tối đa 5 phút, output
64.000 ký tự. Taskkill xử lý cây native Windows, chưa bảo đảm mọi descendant Linux/WSL.
Không dùng task daemon. writable=false chặn chỉnh sửa nhưng verification vẫn có
thể chạy nếu operator allowlist; giữ verification={} để chỉ đọc hoàn toàn.

## Bảo mật và tunnel

Guard chặn traversal, absolute/UNC tool paths, ADS, device names, control chars,
symlink/junction/hardlink và secret paths phổ biến. Không log source/token.
Denylist không phát hiện mọi secret; không loại bỏ race với writer bên ngoài.
Xem [SECURITY.md](SECURITY.md) để hiểu giới hạn và báo lỗi riêng tư.

ChatGPT cần quyền MCP phù hợp; project không tự tạo/cấu hình tunnel. Tunnel được
tạo chưa chứng minh ChatGPT end-to-end đã hoạt động. Xem tài liệu chính thức:
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
[Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).

Khuyến nghị tunnel-client Windows với stdio. Chuỗi mcp-command mẫu:

```text
node "C:/MCP/mcp-project-assistant/dist/index.js" --config "C:/MCP/config/workspaces.json" --workspace project-a --transport stdio
```

Theo help của phiên bản tunnel-client để tạo profile, doctor rồi run. Giữ API key
trong môi trường/secret store ngoài repo. MCP stdio không cần OpenAI API key.
Không đưa HTTP bearer local lên public No authentication.

## Kiểm thử và mở rộng

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
node scripts/Smoke-Local.mjs config/workspaces.json project-a
```

Smoke script yêu cầu readonly/no-verification, kiểm tra package.json và Git diff
không in source. Fixtures chỉ ở .test-runs của MCP. Xem [TESTING.md](TESTING.md),
[CONTRIBUTING.md](CONTRIBUTING.md). CI chạy Windows/Linux.

config/security/budget/context quản lý truy cập; editing xử lý preview/ghi;
process/git cố định argv; tools/* đăng ký từng nhóm, server factory phục vụ stdio
và HTTP. Thêm registerX(server, context), dùng tool() và Guard, thêm behavioral
tests. SDK: [TypeScript MCP v2](https://ts.sdk.modelcontextprotocol.io/v2/).
