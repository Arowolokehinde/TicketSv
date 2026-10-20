# Counterfoil scaffold

This foundation is React-only. The existing prototype remains the design reference, and all wallet/device feasibility gates are untested.

## Provenance

Generated on 2026-10-20 with `create-bsv-app@1.1.2`, React starter, `--network test --package-manager npm --skip-install --no-glue --yes`. Generation ran in `/tmp/counterfoil-starter.YbF7nA` and copied only audited files into the project. The CLI delegated its base template to create-vite; resolved package versions and the lockfile pin the promoted result. Future CLI generation alone is not a bit-for-bit reproduction; use this repository and `npm ci`.

`bsv-scaffold.json` is the unchanged original generation manifest. Its `wallet-connect` capability describes generated source, not installed functionality: all generated `src/bsv/` helpers were deliberately omitted. Do not blindly regenerate using the manifest.

Original manifest:

```json
{
  "version": 2,
  "name": "offline-ticket",
  "network": "test",
  "stack": {"frontend": {"framework": "react", "variant": "react-ts"}},
  "targets": {"client": ""},
  "bsvDir": "src/bsv",
  "capabilities": ["wallet-connect"],
  "starter": {"id": "react", "kind": "generated"}
}
```

## Generated-file audit

| Generated item | Decision |
|---|---|
| React, React DOM, TypeScript, Vite/plugin, React/Node types | Keep the frontend foundation; pin resolved versions. |
| `@bsv/sdk` | Keep dependency for the forthcoming wallet experiments; no runtime import or WalletClient instantiation yet. |
| `@bsv/wallet-relay`, WalletConnectionContext/WalletContext/WalletProviders/ConnectWallet | Omit relay fallback and generated connection UI. |
| `@bsv/auth`, auth.ts | Omit login/request-auth subsystem. |
| config.ts, apiClient.ts, serverIdentity.ts | Omit API-origin requirement and server identity discovery. |
| walletAcquisition.ts | Omit until the actual supported offline wallet path is tested. |
| react-router-dom | Omit; scaffold needs only a static preview redirect and developer route. |
| Starter App, logos, hero image, icon assets, CSS, README | Omit replacement visual design. Existing Counterfoil is preserved. |
| Generated AGENTS.md | Read, but do not promote server/relay instructions that conflict with this project. |
| ESLint template dependencies/configuration | Omit unused tooling; TypeScript, Vitest and Playwright provide this phase's checks. |
| tsconfig*.json, Vite configuration, manifest | Retain starter structure; extend configuration for tests. |

No generated wallet/auth helper code was promoted, and no server-side runtime is included. Installed packages retain their own license metadata. No API secrets or environment file is needed. The application network is the literal `testnet`; the generator's spelling is `test`.

## Toolchain and verification

Node 22.20.0; npm 11.6.1. Dependency versions and verification results will be recorded once checks finish. Initial pins are provisional until real wallet compatibility testing.

Resolved provisional versions:

- @bsv/sdk: 2.8.11
- react: 19.3.1
- react-dom: 19.3.1
- @playwright/test: 1.64.1
- @types/node: 24.19.2
- @types/react: 19.3.0
- @types/react-dom: 19.3.0
- @vitejs/plugin-react: 6.1.2
- typescript: 6.0.3
- vite: 8.3.4
- vitest: 4.1.11

Task 1: clean install, two configuration tests, typecheck and Vite production build passed. All nine pre-existing document/prototype files match the baseline SHA-256 hashes.
