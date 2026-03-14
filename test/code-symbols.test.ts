import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createCodeSymbolsTool } from "../src/tool.js";
import { LspServerManager } from "../src/server-manager.js";
import { SourceExtractor } from "../src/source-extractor.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

function createWorkspace(): { cwd: string; logFile: string } {
	const cwd = mkdtempSync(join(tmpdir(), "pi-lsp-"));
	tempDirs.push(cwd);
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(join(cwd, "src"), { recursive: true });
	mkdirSync(join(cwd, "test"), { recursive: true });
	mkdirSync(join(cwd, "pkg"), { recursive: true });
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname='fixture'\n");
	writeFileSync(join(cwd, "src", "app.ts"), "export function runTask() {\n  return 1;\n}\n");
	writeFileSync(join(cwd, "test", "app.test.ts"), "runTask();\n");
	writeFileSync(join(cwd, "pkg", "tool.py"), "def make_widget():\n    return 1\n");
	const logFile = join(cwd, "lsp.log");
	const serverScript = join(import.meta.dir, "fake-lsp-server.ts");
	writeFileSync(
		join(cwd, ".pi", "lsp.json"),
		JSON.stringify(
			{
				servers: [
					{
						id: "ts",
						languages: ["typescript"],
						fileGlobs: ["src/*.ts", "test/*.ts"],
						rootMarkers: ["package.json"],
						command: {
							command: "bun",
							args: ["run", serverScript],
							env: {
								FAKE_LSP_MODE: "typescript",
								FAKE_LSP_LOG_FILE: logFile,
							},
						},
					},
					{
						id: "py",
						languages: ["python"],
						fileGlobs: ["pkg/*.py"],
						rootMarkers: ["pyproject.toml"],
						command: {
							command: "bun",
							args: ["run", serverScript],
							env: {
								FAKE_LSP_MODE: "python",
								FAKE_LSP_LOG_FILE: logFile,
							},
						},
					},
				],
			},
			null,
			2,
		),
	);
	return { cwd, logFile };
}

function createContext(cwd: string) {
	return {
		cwd,
	} as never;
}

describe("code_symbols", () => {
	test("search routes to the matching configured server", async () => {
		const { cwd, logFile } = createWorkspace();
		const manager = new LspServerManager();
		const tool = createCodeSymbolsTool(manager, new SourceExtractor());

		const result = await tool.execute(
			"tool-call-1",
			{
				action: "search",
				name: "run*",
				filePath: "src/app.ts",
			},
			undefined,
			undefined,
			createContext(cwd),
		);

		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("runTask");
		expect(result.details).toEqual({
			serverId: "ts",
			rootPath: cwd,
			count: 1,
		});

		await manager.stopAll();
		const log = readFileSync(logFile, "utf8");
		expect(log).toContain("initialize:typescript");
		expect(log).toContain("workspace/symbol:typescript");
		expect(log).toContain("shutdown:typescript");
	});

	test("definitions use document symbols and definition lookup", async () => {
		const { cwd, logFile } = createWorkspace();
		const manager = new LspServerManager();
		const tool = createCodeSymbolsTool(manager, new SourceExtractor());

		const result = await tool.execute(
			"tool-call-2",
			{
				action: "definitions",
				name: "runTask",
				filePath: "src/app.ts",
				includeSource: true,
			},
			undefined,
			undefined,
			createContext(cwd),
		);

		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("runTask");
		expect(result.content[0].text).toContain("```");
		await manager.stopAll();

		const log = readFileSync(logFile, "utf8");
		expect(log).toContain("didOpen:typescript");
		expect(log).toContain("documentSymbol:typescript");
		expect(log).toContain("definition:typescript");
	});

	test("references can route to a different server family", async () => {
		const { cwd, logFile } = createWorkspace();
		const manager = new LspServerManager();
		const tool = createCodeSymbolsTool(manager, new SourceExtractor());

		const result = await tool.execute(
			"tool-call-3",
			{
				action: "references",
				name: "make_*",
				filePath: "pkg/tool.py",
			},
			undefined,
			undefined,
			createContext(cwd),
		);

		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("make_widget");
		expect(result.details).toEqual({
			serverId: "py",
			rootPath: cwd,
			count: 1,
		});
		await manager.stopAll();

		const log = readFileSync(logFile, "utf8");
		expect(log).toContain("initialize:python");
		expect(log).toContain("references:python");
	});
});
