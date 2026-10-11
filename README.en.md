# mcp-project-assistant

Give your MCP client access to a code project on your own machine. This server reads files, searches code and returns Git diffs so an AI can understand the project or prepare a prompt for a local coding agent. It can also preview and apply code changes when you ask.

The server uses TypeScript and the official MCP SDK v2. It runs separately from your application and serves one selected workspace per process. Example configurations are read-only, with verification commands disabled.

[Vietnamese documentation](README.md) · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Start on Windows

Install Node.js 24 or later, npm and Git. In PowerShell:

```powershell
git clone https://github.com/thminh176/mcp-project-assistant.git
Set-Location mcp-project-assistant
npm.cmd ci
npm.cmd run build
Copy-Item config/workspaces.example.json config/workspaces.json
```

Edit `config/workspaces.json`. Set `root` to an absolute project path and add sensitive files or folders to `denyPaths`. Then start the selected workspace:

```powershell
node dist/index.js --config config/workspaces.json --workspace project-a --transport stdio
```

Or use the PowerShell launcher:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Mcp.ps1 -Workspace project-a
```

On Linux, use `npm` instead of `npm.cmd` and start Node directly. The test suite runs on Windows and Linux; the PowerShell launcher and WSL adapter are specific to Windows.

## Connect a local MCP client

For clients that use `mcpServers`, replace these paths with your own:

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

Other clients may use a different configuration schema. Keep the same command and arguments. Run a separate process for each workspace; clients cannot switch the selected workspace through a tool.

## What the tools do

| Tool | Purpose |
| --- | --- |
| `workspace_info` | Show the selected workspace and enabled capabilities |
| `read_file` | Read valid UTF-8 source with line numbers and a SHA-256 hash |
| `project_structure` | List permitted files with traversal limits |
| `search_code` | Search literal text in permitted source files |
| `analyze_dependencies` | Read direct dependency declarations from package.json |
| `git_diff` | Return a staged or unstaged diff for one permitted file |
| `preview_edit` | Preview file creation, replacement or a single-file unified patch |
| `apply_edit` | Apply a preview using its one-use token |
| `run_verification` | Run an operator-configured lint, typecheck, test or build command |

Editing requires `writable: true`. Existing files require the current hash, and preview tokens expire after five minutes. The MCP host still needs to approve write calls: a token does not prove user consent. Verification accepts only fixed commands from your configuration, never a shell string supplied by the client.

## HTTP and ChatGPT

Streamable HTTP binds to loopback and requires a bearer token:

```powershell
$env:MCP_HTTP_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node dist/index.js --config config/workspaces.json --workspace project-a --transport http --port 8787
```

The endpoint is `http://127.0.0.1:8787/mcp`. Send `Authorization: Bearer <token>`. This server does not implement OAuth or public HTTPS; keep it local.

For ChatGPT, consult the official [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). A tunnel client can launch the server over stdio. Availability depends on your account and workspace permissions. Creating a tunnel alone does not verify a working ChatGPT connection.

## Before enabling edits or verification

File guards reject traversal, common secret paths and links. They cannot detect secrets embedded in ordinary source or old Git revisions. Review your denylist before sharing project content.

Verification runs project code with your OS permissions. It is not a sandbox. File replacements preserve the existing file object and its permissions, but a crash during a write can leave partial contents. Use version control or backups and avoid concurrent writers. See [SECURITY.md](SECURITY.md) for the full trust model.

## Test or install a local package

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd pack
npm.cmd install -g ./mcp-project-assistant-1.0.0.tgz
mcp-project-assistant --help
```

The project has not been published to npm. Tests use fixtures inside the MCP project, not application repositories. CI covers Windows and Linux, including installation and MCP calls from the packaged server.

Released under the [MIT license](LICENSE).
