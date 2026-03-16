# HACKING.md

Developer guide for contributing to **pi-lsp**, an extension for the [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Prerequisites

- [Bun](https://bun.sh/) v1.x — used as both runtime and package manager (not Node.js)
- [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) installed globally (`npm install -g @mariozechner/pi-coding-agent` or equivalent)
- TypeScript-aware editor (VS Code or Zed recommended)

## Setup

```bash
git clone <repo-url>
cd pi-lsp
bun install
```

## Development workflow

```bash
bun run check    # Type-check with tsc --noEmit
bun run format   # Auto-format with Prettier
bun test         # Run test suite
```

All three checks must pass before submitting a PR. They run identically in CI.

## Running the extension locally

Load the extension directly from source when starting pi:

```bash
pi --extension ./src/index.ts
```

Because `package.json` declares the extension entry point under `"pi".extensions`, you can also run pi from the repository root and it will pick up the extension automatically:

```bash
cd /path/to/your/project
pi --extension /path/to/pi-lsp/src/index.ts
```

Bun transpiles TypeScript on the fly — no build step is required.

## Configuring a workspace for testing

Create `.pi/lsp.json` in the workspace root you want to test against. Example for TypeScript:

```json
{
  "defaultLimit": 25,
  "servers": [
    {
      "id": "ts",
      "name": "TypeScript",
      "languages": ["typescript", "javascript"],
      "rootMarkers": ["package.json", "tsconfig.json"],
      "command": {
        "command": "vtsls",
        "args": ["--stdio"]
      }
    }
  ]
}
```

Install any LSP server binaries separately (e.g. `npm install -g vtsls`). pi-lsp does not auto-install them.

## Debugging in VS Code

1. Install the [Bun for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) extension.

2. Create `.vscode/launch.json` in the pi-lsp repository:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "bun",
      "request": "launch",
      "name": "Run tests",
      "program": "bun",
      "args": ["test", "--timeout", "30000"],
      "cwd": "${workspaceFolder}",
      "stopOnEntry": false
    },
    {
      "type": "bun",
      "request": "launch",
      "name": "Run extension (attach pi)",
      "program": "bun",
      "args": ["run", "${workspaceFolder}/src/index.ts"],
      "cwd": "${workspaceFolder}",
      "stopOnEntry": false
    }
  ]
}
```

3. Set breakpoints in any `.ts` source file, then press **F5** (or **Run > Start Debugging**) with the desired configuration selected.

> **Tip:** To debug while running pi interactively, launch pi from a terminal with `pi --extension ./src/index.ts` and attach VS Code's Bun debugger by adding a configuration with `"request": "attach"` and the appropriate port (Bun defaults to `6499`).

## Debugging in Zed

Zed supports Bun via the [DAP (Debug Adapter Protocol)](https://zed.dev/docs/debugger) integration.

1. Open the pi-lsp folder in Zed.

2. Create `.zed/debug.json` (Zed debug tasks file):

```json
[
  {
    "label": "Bun: run tests",
    "adapter": "bun",
    "request": "launch",
    "program": "bun",
    "args": ["test"],
    "cwd": "${ZED_WORKTREE_ROOT}"
  },
  {
    "label": "Bun: run extension",
    "adapter": "bun",
    "request": "launch",
    "program": "bun",
    "args": ["run", "src/index.ts"],
    "cwd": "${ZED_WORKTREE_ROOT}"
  }
]
```

3. Open the debug panel (**View > Debug**), select a task from the dropdown, and click **Start**.

4. Set breakpoints by clicking in the gutter next to any line in a `.ts` file.

> **Tip:** Zed's debugger requires Bun ≥ 1.1.x which ships with built-in DAP support. Run `bun --version` to confirm.

## Project layout

```
src/
  index.ts            # Extension entry point — registers tools and event hooks
  tool.ts             # code_symbols tool definition and request dispatch
  config.ts           # .pi/lsp.json loading and server routing logic
  types.ts            # Shared TypeScript type definitions
  server-manager.ts   # LSP subprocess lifecycle (spawn, cache, shutdown)
  lsp-client.ts       # JSON-RPC 2.0 client over stdio
  source-extractor.ts # Source snippet extraction from LSP symbol ranges
test/
  code-symbols.test.ts  # Integration tests
  fake-lsp-server.ts    # Fake LSP server for deterministic test responses
```

## How the extension integrates with pi

pi-lsp exports a default function that receives an `ExtensionAPI` object from the pi runtime:

```typescript
// src/index.ts
export default function (pi: ExtensionAPI) {
  pi.registerTool(codeSymbolsTool);
  pi.on("session_shutdown", () => serverManager.stopAll());
}
```

The `"pi".extensions` field in `package.json` tells pi which file to load when the package is used as an extension source.

## Adding a new language server

1. Add a new entry to the `servers` array in the target workspace's `.pi/lsp.json`.
2. Ensure the server binary is on `$PATH` or specify an absolute path in `command.command`.
3. Test routing by running `bun test` — the fake LSP server in `test/` handles the protocol layer.

## CI

GitHub Actions runs on every PR to `main`:

| Check     | Command                    |
| --------- | -------------------------- |
| Format    | `bunx prettier --check .`  |
| Types     | `bun run check`            |
| Tests     | `bun test`                 |

Fix formatting automatically with `bun run format` before pushing.
