param(
  [Parameter(Mandatory = $true)][string]$Workspace,
  [string]$Config = '',
  [ValidateSet('stdio', 'http')][string]$Transport = 'stdio',
  [ValidateRange(1, 65535)][int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $projectRoot 'config/workspaces.json' }
$entry = Join-Path $projectRoot 'dist/index.js'
if (-not (Test-Path -LiteralPath $entry)) { throw 'Chay npm.cmd ci va npm.cmd run build trong project MCP truoc.' }
if (-not (Test-Path -LiteralPath $Config)) { throw 'Chua co config workspace. Sao chep config/workspaces.example.json va sua duong dan.' }
& node $entry --config $Config --workspace $Workspace --transport $Transport --port $Port
exit $LASTEXITCODE
