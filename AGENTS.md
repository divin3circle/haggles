# AGENTS.md — rules for AI coding agents in this repo

These rules mirror SPEC.md section 0.2. The spec is the source of truth; if code and spec disagree, the spec wins until it is changed in a pull request.

1. Read the SPEC.md section(s) relevant to your task before writing code. Cite the section in your PR description.
2. One task = one small PR. Do not refactor unrelated code.
3. Never change the wire protocol (SPEC.md section 4), the ledger rules (section 6), or the security rules (section 8) without a spec change reviewed by a human.
4. Every exported function, type, and route MUST have TSDoc or an OpenAPI description. Docs are part of "done" (section 13).
5. Every money-moving code path MUST have a test that proves idempotency and ledger balance.
6. Never log secrets, tokens, API keys, or full PayPal payloads.
7. If reality contradicts an external fact in the spec (an API behaves differently from Appendix C), stop and report. Do not work around it silently.

## Toolchain

- **Bun everywhere**: package manager and scripts. Use `bun install`, `bun --filter <pkg> <script>`. Do not introduce pnpm/npm/yarn.
- Tests run with Vitest via `bunx vitest` (see SPEC.md amendment history).
- The portal (`apps/portal`) theme, fonts, and color tokens come from the original template and MUST NOT be changed.

## Per-directory rules

- `apps/portal/AGENTS.md` contains the Next.js template's agent rules. It applies inside `apps/portal/` — read `node_modules/next/dist/docs/` guides before writing Next.js code there.
