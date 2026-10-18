# Publishing the MCP server (`perigee-mcp`)

The MCP server in `mcp/` is published to npm as `perigee-mcp`, with its own version number (`mcp/package.json`),
independent of the site's. The first version is published by hand; the following ones by
`.github/workflows/mcp-release.yml` through npm **trusted publishing** (OIDC): GitHub Actions proves to npm which
repository and workflow it runs, so no npm token is stored in GitHub, and each version gets a provenance
attestation automatically.

References: [Trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[Publishing unscoped public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## 1. npm account (once)

1. Create an account on <https://www.npmjs.com/signup> and confirm the e-mail address.
2. Account → Settings → enable **two-factor authentication** (an authenticator app or a security key). It is required
   to publish and to configure trusted publishing.
3. Log the local npm in: `npm login` (opens the browser), then `npm whoami` prints the user name.

## 2. Check the package locally

From the repository root. On Windows, stop the dev server (`npm run dev`) and any `vite preview` or Playwright run
first: they keep native binaries of `node_modules` open, and `npm ci` then fails with `EPERM … unlink
…rolldown-binding.win32-x64-msvc.node` after deleting part of `node_modules` (run it again once they are stopped).

```bash
npm ci
npx vitest run tests/engine.test.ts tests/mcp.test.ts
npm run mcp:build
cd mcp && npm pack --dry-run      # expect LICENSE, README.md, dist/perigee-mcp.js, package.json
```

Try the built server in an MCP client before publishing, e.g. Claude Code:
`claude mcp add perigee-local -- node <repo>/mcp/dist/perigee-mcp.js` (remove it afterwards with
`claude mcp remove perigee-local`), or in Claude Desktop's `claude_desktop_config.json`:

```json
{ "mcpServers": { "perigee-local": { "command": "node", "args": ["E:/Perigee/mcp/dist/perigee-mcp.js"] } } }
```

## 3. First version, by hand (once)

The package must exist before a trusted publisher can be attached to it.

```bash
cd mcp
npm publish --access public       # asks for the 2FA code or a browser confirmation
```

Then check <https://www.npmjs.com/package/perigee-mcp> and, on a machine with Node 20+, `npx -y perigee-mcp` (it
waits silently on stdin: stop it with Ctrl+C).

Tag that commit so the history matches: `git tag mcp-v0.1.0 && git push origin mcp-v0.1.0`. The workflow runs its
checks and skips `npm publish`, since that version is already on npm.

## 4. Trusted publisher (once)

On npmjs.com: package `perigee-mcp` → Settings → **Trusted Publisher** → GitHub Actions:

- Organization or user: `dlamarre-dev`
- Repository: `Perigee`
- Workflow filename: `mcp-release.yml`
- Environment: leave empty

Or from the command line (npm 11.15 or later): `npm trust github perigee-mcp --repo dlamarre-dev/Perigee --file
mcp-release.yml --allow-publish`.

Then, in the same settings page, **Publishing access** → "Require two-factor authentication and disallow tokens":
only the workflow (and you, with 2FA) can publish.

`repository.url` in `mcp/package.json` must stay `git+https://github.com/dlamarre-dev/Perigee.git`, and the workflow
file must keep its name: npm checks both.

## 5. Each following version

1. Change `mcp/` (or the engine or catalogues it bundles) and bump `version` in `mcp/package.json` (semver: patch for
   fixes and catalogue updates, minor for new tools or parameters, major for removed or renamed tools).
2. Commit and push to `master`; wait for CI.
3. Tag and push: `git tag mcp-v0.1.1 && git push origin mcp-v0.1.1`.
4. The workflow checks that the tag matches the version, runs the engine and MCP tests, builds and publishes. The npm
   page then shows the provenance (link to the workflow run and the commit).

The bundle includes the catalogues as they were at build time (names, goals, ids); positions always come from the
data published on perigee.info, so a new MCP version is only needed for code or catalogue changes, not for fresh data.
