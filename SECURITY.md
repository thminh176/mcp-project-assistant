# Security policy

This server targets one trusted operator and local MCP clients. Only the current
release is maintained. Do not expose the HTTP listener publicly.

## Reporting

Use GitHub Security Advisories (Security → Report a vulnerability) when enabled.
If unavailable, contact the repository maintainer privately through a channel on
their profile. Never post credentials, customer source or private paths in public
issues. Maintainers must enable private vulnerability reporting before publishing.

## Trust boundaries and limitations

- The operator controls configuration, selected workspace and fixed verifier argv.
  MCP inputs and project source are untrusted; source comments are never instructions.
- File tools restrict relative paths, deny common secrets and reject links. Denylists
  cannot detect secrets embedded in arbitrary source or historical Git revisions.
- Traversal/search share a 10-second deadline. A filesystem call in progress may
  finish after timeout, but cannot resume a timed-out traversal or perform writes.
  Large directories still consume memory; this is not a hostile multi-user service.
- Editing requires writable configuration, current hash and a one-use preview.
  The token is not proof of user approval; the MCP host must approve write tools.
- Replacements retain the existing file object, ACL/mode/ownership. They are not
  crash-atomic. Disk errors/crashes can leave partial contents; use Git/backups.
- External writers can race path checks. Use OS ACLs or a VM for malicious processes.
  Preview hashes are not cross-process transactions; avoid concurrent writers.
- Verification runs trusted code with the operator's OS privileges. The argv
  allowlist is not an OS sandbox: code may use the network or read external files.
  Protect runner/config paths and use a restricted OS account or VM if needed.
- Windows taskkill terminates native process trees. Linux/WSL descendants are not
  guaranteed to terminate with a transport parent. Do not use daemon verifiers.
- HTTP uses a shared bearer token, loopback binding and Host/Origin checks. It has
  no OAuth, tenant isolation or persistent audit trail; clients share preview state.

Keep tunnel profiles and runtime credentials outside the repository. Ignore
patterns only cover common names. Review source, diff and verifier output before
sharing. Never select the MCP server's own configuration as an editable target.
