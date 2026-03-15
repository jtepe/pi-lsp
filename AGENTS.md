# AGENTS.md

## Project overview

pi-lsp is a standalone extension for the pi coding agent that provides a
`code_symbols` tool backed by Language Server Protocol (LSP) processes. It
enables semantic code navigation (symbol search, definitions, references) across
multiple programming languages by spawning and managing LSP subprocesses.

## Tech stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode, ES2023 target, ESM)
- **Test framework**: Bun's native test runner (`bun:test`)
- **Formatter**: Prettier (default config)

## Repository layout

```
src/
  index.ts            # Extension entry point, registers tool with pi
  tool.ts             # code_symbols tool definition and request handling
  config.ts           # Configuration loading (.pi/lsp.json) and server routing
  types.ts            # Shared TypeScript type definitions
  server-manager.ts   # LSP server lifecycle management (spawn, cache, shutdown)
  lsp-client.ts       # LSP JSON-RPC client over stdio
  source-extractor.ts # Extract source snippets from symbol ranges
test/
  code-symbols.test.ts # Integration tests for the code_symbols tool
  fake-lsp-server.ts   # Mock LSP server used by tests
```

## Development commands

All commands use `bun`, not `npm` or `node`.

| Command          | Purpose                             |
| ---------------- | ----------------------------------- |
| `bun install`    | Install dependencies                |
| `bun test`       | Run tests                           |
| `bun run check`  | Type-check with `tsc --noEmit`      |
| `bun run format` | Auto-format all files with Prettier |

## Workflow requirements

Before submitting any change, **all three checks must pass**:

```sh
bunx prettier --check .   # 1. Formatting
bun run check             # 2. Type checking
bun test                  # 3. Tests
```

These same checks run in CI on every pull request targeting `main` and must pass
before the PR can be merged. Run them locally before pushing.

If formatting fails, fix it with `bun run format`.

## Testing conventions

- Tests live in `test/` and use the `*.test.ts` suffix.
- The test suite uses a `fake-lsp-server.ts` that simulates real LSP servers
  over stdio with canned JSON-RPC responses.
- Tests create temporary workspace directories, run the tool against the fake
  server, and clean up in `afterEach`.
- When adding new functionality, add or extend tests in `test/`.

## Code style

- Prettier defaults (no config file) — run `bun run format` to auto-fix.
- TypeScript strict mode is enabled; do not weaken compiler options.
- The project uses ES modules (`"type": "module"` in package.json). Use
  `import`/`export`, not `require`.

## Dependencies

Do not add new dependencies without justification. The project is intentionally
lightweight. Key dependencies:

- `@mariozechner/pi-coding-agent` / `@mariozechner/pi-ai` — pi agent framework
- `@sinclair/typebox` — JSON schema definitions for tool parameters
- `minimatch` — glob pattern matching for LSP server file routing
