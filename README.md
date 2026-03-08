# pi-lsp

Standalone pi extension that adds a `code_symbols` tool backed by project-configured Language Server Protocol processes.

## Status

Current implementation:

- Spawns and manages one LSP subprocess per `(server id, workspace root)` pair
- Supports multiple configured servers in the same workspace
- Routes requests by `serverId`, `language`, and `filePath`
- Cleans up all spawned processes on pi shutdown and extension reload
- Exposes `search`, `definitions`, and `references` through the `code_symbols` tool
- Returns optional source snippets using the LSP-reported range

Not implemented yet:

- Tree-sitter-based expansion from a symbol range to the enclosing syntax node
- Automatic installation or discovery of language servers
- Rich disambiguation UI when multiple document symbols match the same pattern

## Install

```bash
cd /path/to/pi-lsp
bun install
```

Load it in pi:

```bash
pi --extension /path/to/pi-lsp/src/index.ts
```

Or point pi at the package directory if you use it as a project extension source.

## Configuration

Create `.pi/lsp.json` in the target workspace:

```json
{
  "defaultLimit": 25,
  "maxLimit": 100,
  "servers": [
    {
      "id": "ts",
      "name": "TypeScript",
      "languages": ["typescript", "javascript"],
      "fileGlobs": ["src/*.ts", "src/*.tsx", "test/*.ts"],
      "rootMarkers": ["package.json", "tsconfig.json"],
      "command": {
        "command": "vtsls",
        "args": ["--stdio"]
      }
    },
    {
      "id": "py",
      "name": "ty",
      "languages": ["python"],
      "fileGlobs": ["pkg/*.py", "tests/*.py"],
      "rootMarkers": ["pyproject.toml", "setup.py"],
      "command": {
        "command": "ty",
        "args": ["--stdio"]
      }
    },
    {
      "id": "rust",
      "name": "rust-analyzer",
      "languages": ["rust"],
      "fileGlobs": ["src/*.rs", "tests/*.rs", "examples/*.rs"],
      "rootMarkers": ["Cargo.toml"],
      "command": {
        "command": "rust-analyzer"
      }
    }
  ]
}
```

### Fields

- `servers`: required, non-empty array
- `id`: stable server identifier
- `languages`: optional language filter used during routing
- `fileGlobs`: optional minimatch globs evaluated relative to the workspace cwd
- `rootMarkers`: optional files/directories used to compute the server root
- `command.command`: executable to spawn
- `command.args`: optional argument array
- `command.env`: optional environment variables
- `initializationOptions`: optional LSP initialization payload
- `trace`: optional LSP trace level
- `treeSitterLanguage`: reserved for upcoming tree-sitter source expansion

## Tool API

The extension registers one tool:

- `code_symbols`

Parameters:

- `action`: `"search" | "definitions" | "references"`
- `name`: symbol name or wildcard pattern
- `filePath`: optional for `search`, required for `definitions` and `references`
- `language`: optional language override
- `serverId`: optional explicit server override
- `includeSource`: include source snippets in results
- `limit`: result cap

Examples:

```text
Use code_symbols to search for "run*"
Use code_symbols to find definitions of "runTask" in src/app.ts
Use code_symbols to find references of "make_widget" in pkg/tool.py
```

## Development

```bash
bun run check
bun test
```

The tests use a fake stdio LSP server and verify:

- server routing across multiple configured servers
- workspace symbol search
- document symbol + definition flow
- references flow
- shutdown cleanup
