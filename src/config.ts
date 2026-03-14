import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { minimatch } from "minimatch";
import type { ExtensionConfig, LspServerConfig, WorkspaceMatch } from "./types.js";

const CONFIG_CANDIDATES = [".pi/lsp.json", ".pi/lsp.jsonc"];
const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_LIMIT = 100;

function stripJsonComments(text: string): string {
	return text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== "object") return false;
	return Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseServerConfig(value: unknown, index: number): LspServerConfig {
	if (!value || typeof value !== "object") {
		throw new Error(`Invalid server config at index ${index}`);
	}
	const record = value as Record<string, unknown>;
	const command = record.command;
	if (!command || typeof command !== "object") {
		throw new Error(`Server ${index} is missing command`);
	}
	const commandRecord = command as Record<string, unknown>;
	if (typeof commandRecord.command !== "string" || commandRecord.command.trim().length === 0) {
		throw new Error(`Server ${index} command.command must be a non-empty string`);
	}
	if (commandRecord.args !== undefined && !isStringArray(commandRecord.args)) {
		throw new Error(`Server ${index} command.args must be a string array`);
	}
	if (commandRecord.env !== undefined && !isStringRecord(commandRecord.env)) {
		throw new Error(`Server ${index} command.env must be an object of strings`);
	}
	if (record.id !== undefined && typeof record.id !== "string") {
		throw new Error(`Server ${index} id must be a string`);
	}
	if (record.name !== undefined && typeof record.name !== "string") {
		throw new Error(`Server ${index} name must be a string`);
	}
	if (record.languages !== undefined && !isStringArray(record.languages)) {
		throw new Error(`Server ${index} languages must be a string array`);
	}
	if (record.fileGlobs !== undefined && !isStringArray(record.fileGlobs)) {
		throw new Error(`Server ${index} fileGlobs must be a string array`);
	}
	if (record.rootMarkers !== undefined && !isStringArray(record.rootMarkers)) {
		throw new Error(`Server ${index} rootMarkers must be a string array`);
	}
	if (record.treeSitterLanguage !== undefined && typeof record.treeSitterLanguage !== "string") {
		throw new Error(`Server ${index} treeSitterLanguage must be a string`);
	}
	if (record.trace !== undefined && record.trace !== "off" && record.trace !== "messages" && record.trace !== "verbose") {
		throw new Error(`Server ${index} trace must be one of off, messages, verbose`);
	}
	return {
		id: typeof record.id === "string" ? record.id : `server-${index + 1}`,
		name: typeof record.name === "string" ? record.name : undefined,
		languages: isStringArray(record.languages) ? record.languages : undefined,
		fileGlobs: isStringArray(record.fileGlobs) ? record.fileGlobs : undefined,
		rootMarkers: isStringArray(record.rootMarkers) ? record.rootMarkers : undefined,
		command: {
			command: commandRecord.command,
			args: isStringArray(commandRecord.args) ? commandRecord.args : undefined,
			env: isStringRecord(commandRecord.env) ? commandRecord.env : undefined,
		},
		initializationOptions: record.initializationOptions,
		trace: record.trace as "off" | "messages" | "verbose" | undefined,
		treeSitterLanguage: typeof record.treeSitterLanguage === "string" ? record.treeSitterLanguage : undefined,
	};
}

export function loadConfig(cwd: string): ExtensionConfig {
	for (const candidate of CONFIG_CANDIDATES) {
		const path = resolve(cwd, candidate);
		if (!existsSync(path)) continue;
		const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as Record<string, unknown>;
		const serversValue = parsed.servers;
		if (!Array.isArray(serversValue) || serversValue.length === 0) {
			throw new Error(`${candidate} must define a non-empty servers array`);
		}
		const servers = serversValue.map((entry, index) => parseServerConfig(entry, index));
		const defaultLimit = typeof parsed.defaultLimit === "number" ? parsed.defaultLimit : DEFAULT_LIMIT;
		const maxLimit = typeof parsed.maxLimit === "number" ? parsed.maxLimit : DEFAULT_MAX_LIMIT;
		const eagerInit = parsed.eagerInit === true;
		return { servers, defaultLimit, maxLimit, eagerInit };
	}
	throw new Error("No .pi/lsp.json or .pi/lsp.jsonc configuration found");
}

function pathHasMarker(path: string, marker: string): boolean {
	try {
		accessSync(join(path, marker), constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function findRootPath(startPath: string, markers: string[] | undefined, cwd: string): string {
	if (!markers || markers.length === 0) return cwd;
	let current = startPath;
	while (true) {
		if (markers.some((marker) => pathHasMarker(current, marker))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return cwd;
}

export function detectLanguageFromPath(path: string): string | undefined {
	const extension = extname(path).toLowerCase();
	switch (extension) {
		case ".ts":
		case ".tsx":
		case ".mts":
		case ".cts":
			return "typescript";
		case ".js":
		case ".jsx":
		case ".mjs":
		case ".cjs":
			return "javascript";
		case ".py":
			return "python";
		case ".rs":
			return "rust";
		case ".go":
			return "go";
		case ".java":
			return "java";
		case ".c":
		case ".h":
			return "c";
		case ".cc":
		case ".cpp":
		case ".cxx":
		case ".hpp":
			return "cpp";
		case ".json":
			return "json";
		case ".rb":
			return "ruby";
		default:
			return undefined;
	}
}

export function matchServer(
	config: ExtensionConfig,
	cwd: string,
	options: { filePath?: string; language?: string; serverId?: string },
): WorkspaceMatch {
	const absoluteFilePath = options.filePath ? resolve(cwd, options.filePath) : undefined;
	const relativeFilePath = absoluteFilePath ? absoluteFilePath.slice(cwd.length + 1) : undefined;
	const language = options.language ?? (absoluteFilePath ? detectLanguageFromPath(absoluteFilePath) : undefined);

	const candidates = config.servers.filter((server) => {
		if (options.serverId && server.id !== options.serverId) {
			return false;
		}
		if (language && server.languages && server.languages.length > 0 && !server.languages.includes(language)) {
			return false;
		}
		if (relativeFilePath && server.fileGlobs && server.fileGlobs.length > 0) {
			return server.fileGlobs.some((glob) => minimatch(relativeFilePath, glob, { dot: true }));
		}
		return true;
	});

	if (candidates.length === 0) {
		const target = options.serverId ?? language ?? options.filePath ?? "request";
		throw new Error(`No LSP server configuration matches ${target}`);
	}

	const server = candidates[0];
	const rootPath = findRootPath(absoluteFilePath ? dirname(absoluteFilePath) : cwd, server.rootMarkers, cwd);
	return { server, rootPath };
}

export function clampLimit(config: ExtensionConfig, limit: number | undefined): number {
	const fallback = config.defaultLimit ?? DEFAULT_LIMIT;
	const maxLimit = config.maxLimit ?? DEFAULT_MAX_LIMIT;
	const resolved = limit ?? fallback;
	return Math.max(1, Math.min(maxLimit, resolved));
}
