# Contributing

Use Node.js 24+ and Git. In a standalone checkout run:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

On Linux use npm instead of npm.cmd. Test fixtures belong only in .test-runs in
this repository, never in application projects. Windows tests skip elsewhere.

Register new tool modules in src/server.ts and use the shared tool wrapper and
Guard. Never accept client executable/argv decisions. Add behavioral tests for
failure paths and access boundaries. Do not log source, tokens or credentials.
PRs should describe resulting behavior, security implications and validation.
Report vulnerabilities privately according to SECURITY.md.

## Releases

Run CI checks and npm pack, inspect the archive, install it in an isolated folder
and verify the bin command. The files field in package.json is the package
allowlist. Do not commit personal paths, workspace configs or tunnel profiles.
Enable GitHub private vulnerability reporting before making the repository public.
An available package name and maintainer accounts are needed for publishing;
no script publishes automatically. The project uses the MIT license.
