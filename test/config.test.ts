import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-lsp-cfg-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(
  baseDir: string,
  config: object,
  filename = "lsp.json",
): void {
  mkdirSync(join(baseDir, ".pi"), { recursive: true });
  writeFileSync(
    join(baseDir, ".pi", filename),
    JSON.stringify(config, null, 2),
  );
}

const tsServer = {
  id: "ts",
  languages: ["typescript"],
  command: { command: "typescript-language-server", args: ["--stdio"] },
};

const pyServer = {
  id: "py",
  languages: ["python"],
  command: { command: "pylsp" },
};

const goServer = {
  id: "go",
  languages: ["go"],
  command: { command: "gopls" },
};

describe("loadConfig global config", () => {
  test("loads config from global dir when no local config exists", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    writeConfig(globalDir, { servers: [tsServer] });

    const config = loadConfig(localDir, globalDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("ts");
  });

  test("loads config from local dir when no global config exists", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    writeConfig(localDir, { servers: [pyServer] });

    const config = loadConfig(localDir, globalDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("py");
  });

  test("merges global and local configs, local servers first", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    writeConfig(globalDir, { servers: [tsServer, goServer] });
    writeConfig(localDir, { servers: [pyServer] });

    const config = loadConfig(localDir, globalDir);
    expect(config.servers).toHaveLength(3);
    expect(config.servers[0].id).toBe("py");
    expect(config.servers[1].id).toBe("ts");
    expect(config.servers[2].id).toBe("go");
  });

  test("local server overrides global server with same id", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    const globalTs = {
      ...tsServer,
      command: { command: "global-ts-server" },
    };
    const localTs = {
      ...tsServer,
      command: { command: "local-ts-server" },
    };
    writeConfig(globalDir, { servers: [globalTs, goServer] });
    writeConfig(localDir, { servers: [localTs] });

    const config = loadConfig(localDir, globalDir);
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0].id).toBe("ts");
    expect(config.servers[0].command.command).toBe("local-ts-server");
    expect(config.servers[1].id).toBe("go");
  });

  test("local config settings override global settings", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    writeConfig(globalDir, {
      servers: [tsServer],
      defaultLimit: 10,
      maxLimit: 50,
      eagerInit: false,
    });
    writeConfig(localDir, {
      servers: [pyServer],
      defaultLimit: 20,
      maxLimit: 100,
      eagerInit: true,
    });

    const config = loadConfig(localDir, globalDir);
    expect(config.defaultLimit).toBe(20);
    expect(config.maxLimit).toBe(100);
    expect(config.eagerInit).toBe(true);
  });

  test("throws when neither global nor local config exists", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();

    expect(() => loadConfig(localDir, globalDir)).toThrow(
      "No .pi/lsp.json or .pi/lsp.jsonc configuration found",
    );
  });

  test("supports jsonc format in global config", () => {
    const globalDir = makeTempDir();
    const localDir = makeTempDir();
    mkdirSync(join(globalDir, ".pi"), { recursive: true });
    writeFileSync(
      join(globalDir, ".pi", "lsp.jsonc"),
      `{
        // Global LSP config
        "servers": [${JSON.stringify(tsServer)}]
      }`,
    );

    const config = loadConfig(localDir, globalDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("ts");
  });
});
