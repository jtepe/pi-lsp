import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectLanguageFromPath } from "./config.js";
import type {
	DocumentSymbol,
	LspLocation,
	LspLocationLink,
	LspRange,
	LspServerConfig,
	ResolvedSymbolLocation,
	SymbolInformation,
	WorkspaceMatch,
} from "./types.js";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface InitializeResult {
	capabilities?: {
		definitionProvider?: boolean;
		referencesProvider?: boolean;
		workspaceSymbolProvider?: boolean | Record<string, unknown>;
		documentSymbolProvider?: boolean | Record<string, unknown>;
	};
}

interface LspClientState {
	match: WorkspaceMatch;
	process: ChildProcess;
	buffer: Buffer;
	contentLength: number | null;
	nextId: number;
	pending: Map<number, PendingRequest>;
	initialized: boolean;
	capabilities: InitializeResult["capabilities"];
	openDocuments: Set<string>;
}

function toUri(path: string): string {
	return pathToFileURL(path).href;
}

function fromUri(uri: string): string {
	return fileURLToPath(uri);
}

function encodeMessage(payload: unknown): string {
	const json = JSON.stringify(payload);
	return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function offsetAt(text: string, position: { line: number; character: number }): number {
	const lines = text.split("\n");
	let offset = 0;
	for (let index = 0; index < position.line; index++) {
		offset += (lines[index] ?? "").length + 1;
	}
	return offset + position.character;
}

function rangeToSource(path: string, range: LspRange): string {
	const text = readFileSync(path, "utf8");
	return text.slice(offsetAt(text, range.start), offsetAt(text, range.end));
}

function normalizeLocation(location: LspLocation | LspLocationLink): LspLocation {
	if ("uri" in location) {
		return location;
	}
	return {
		uri: location.targetUri,
		range: location.targetSelectionRange ?? location.targetRange,
	};
}

function flattenDocumentSymbols(path: string, uri: string, symbols: DocumentSymbol[], parentName?: string): ResolvedSymbolLocation[] {
	const result: ResolvedSymbolLocation[] = [];
	for (const symbol of symbols) {
		result.push({
			name: symbol.name,
			kind: symbol.kind,
			path,
			uri,
			range: symbol.selectionRange,
			containerName: parentName,
		});
		if (symbol.children && symbol.children.length > 0) {
			result.push(...flattenDocumentSymbols(path, uri, symbol.children, symbol.name));
		}
	}
	return result;
}

export class LspClient {
	private state: LspClientState;

	private constructor(state: LspClientState) {
		this.state = state;
	}

	static async start(match: WorkspaceMatch): Promise<LspClient> {
		const child = spawn(match.server.command.command, match.server.command.args ?? [], {
			cwd: match.rootPath,
			env: { ...process.env, ...match.server.command.env },
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		});

		if (!child.stdin || !child.stdout || !child.stderr) {
			throw new Error(`Failed to spawn ${match.server.command.command}`);
		}

		const state: LspClientState = {
			match,
			process: child,
			buffer: Buffer.alloc(0),
			contentLength: null,
			nextId: 1,
			pending: new Map(),
			initialized: false,
			capabilities: undefined,
			openDocuments: new Set(),
		};
		const client = new LspClient(state);
		child.stdout.on("data", (chunk: Buffer) => client.consume(chunk));
		child.stderr.on("data", () => {});
		child.once("error", (error) => {
			for (const pending of state.pending.values()) {
				pending.reject(error);
			}
			state.pending.clear();
		});
		child.once("exit", () => {
			for (const pending of state.pending.values()) {
				pending.reject(new Error(`LSP server ${match.server.id} exited unexpectedly`));
			}
			state.pending.clear();
		});

		await client.initialize();
		return client;
	}

	get key(): string {
		return `${this.state.match.server.id}:${this.state.match.rootPath}`;
	}

	get server(): LspServerConfig {
		return this.state.match.server;
	}

	get rootPath(): string {
		return this.state.match.rootPath;
	}

	private consume(chunk: Buffer): void {
		this.state.buffer = Buffer.concat([this.state.buffer, chunk]);
		while (true) {
			if (this.state.contentLength === null) {
				const headerEnd = this.state.buffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) return;
				const header = this.state.buffer.subarray(0, headerEnd).toString("utf8");
				this.state.buffer = this.state.buffer.subarray(headerEnd + 4);
				const lengthLine = header
					.split("\r\n")
					.find((line) => line.toLowerCase().startsWith("content-length:"));
				if (!lengthLine) {
					throw new Error("Missing Content-Length header from LSP server");
				}
				this.state.contentLength = Number(lengthLine.split(":")[1]?.trim());
			}
			if (this.state.contentLength === null || this.state.buffer.byteLength < this.state.contentLength) {
				return;
			}
			const payload = this.state.buffer.subarray(0, this.state.contentLength).toString("utf8");
			this.state.buffer = this.state.buffer.subarray(this.state.contentLength);
			this.state.contentLength = null;
			const message = JSON.parse(payload) as { id?: number; result?: unknown; error?: { message?: string } };
			if (typeof message.id === "number") {
				const pending = this.state.pending.get(message.id);
				if (!pending) continue;
				this.state.pending.delete(message.id);
				if (message.error) {
					pending.reject(new Error(message.error.message ?? "Unknown LSP error"));
				} else {
					pending.resolve(message.result);
				}
			}
		}
	}

	private async request<T>(method: string, params: unknown): Promise<T> {
		const id = this.state.nextId++;
		const payload = encodeMessage({ jsonrpc: "2.0", id, method, params });
		return new Promise<T>((resolve, reject) => {
			this.state.pending.set(id, { resolve: (value) => resolve(value as T), reject });
			this.state.process.stdin?.write(payload, "utf8", (error) => {
				if (error) {
					this.state.pending.delete(id);
					reject(error);
				}
			});
		});
	}

	private notify(method: string, params: unknown): void {
		this.state.process.stdin?.write(encodeMessage({ jsonrpc: "2.0", method, params }), "utf8");
	}

	private ensureProcessAlive(): void {
		if (this.state.process.exitCode !== null) {
			throw new Error(`LSP server ${this.state.match.server.id} is not running`);
		}
	}

	private async openDocument(path: string): Promise<void> {
		const uri = toUri(path);
		if (this.state.openDocuments.has(uri)) {
			return;
		}
		const text = readFileSync(path, "utf8");
		this.notify("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: detectLanguageFromPath(path) ?? "plaintext",
				version: 1,
				text,
			},
		});
		this.state.openDocuments.add(uri);
	}

	private async initialize(): Promise<void> {
		const result = await this.request<InitializeResult>("initialize", {
			processId: process.pid,
			rootUri: toUri(this.state.match.rootPath),
			capabilities: {
				workspace: {
					symbol: {
						dynamicRegistration: false,
					},
				},
				textDocument: {
					definition: { dynamicRegistration: false },
					references: { dynamicRegistration: false },
					documentSymbol: { dynamicRegistration: false },
				},
			},
			trace: this.state.match.server.trace ?? "off",
			initializationOptions: this.state.match.server.initializationOptions,
		});
		this.state.capabilities = result.capabilities;
		this.notify("initialized", {});
		this.state.initialized = true;
	}

	async stop(): Promise<void> {
		if (!this.state.process.pid) {
			return;
		}
		if (!this.state.process.killed && this.state.initialized) {
			try {
				await this.request("shutdown", null);
			} catch {}
			try {
				this.notify("exit", null);
			} catch {}
		}
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				try {
					process.kill(-this.state.process.pid!, "SIGTERM");
				} catch {}
				setTimeout(() => {
					try {
						process.kill(-this.state.process.pid!, "SIGKILL");
					} catch {}
					resolve();
				}, 500);
			}, 500);
			this.state.process.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}

	async workspaceSymbols(query: string): Promise<SymbolInformation[]> {
		this.ensureProcessAlive();
		return await this.request<SymbolInformation[]>("workspace/symbol", { query });
	}

	async documentSymbols(path: string): Promise<ResolvedSymbolLocation[]> {
		this.ensureProcessAlive();
		await this.openDocument(path);
		const uri = toUri(path);
		const result = await this.request<Array<SymbolInformation | DocumentSymbol>>("textDocument/documentSymbol", {
			textDocument: { uri },
		});
		if (!Array.isArray(result) || result.length === 0) return [];
		if ("location" in result[0]!) {
			return (result as SymbolInformation[]).map((symbol) => ({
				name: symbol.name,
				kind: symbol.kind,
				path,
				uri,
				range: symbol.location.range,
				containerName: symbol.containerName,
			}));
		}
		return flattenDocumentSymbols(path, uri, result as DocumentSymbol[]);
	}

	async definition(path: string, symbol: ResolvedSymbolLocation): Promise<ResolvedSymbolLocation[]> {
		this.ensureProcessAlive();
		await this.openDocument(path);
		const locations = await this.request<Array<LspLocation | LspLocationLink> | LspLocation | LspLocationLink | null>(
			"textDocument/definition",
			{
				textDocument: { uri: toUri(path) },
				position: symbol.range.start,
			},
		);
		const list = locations === null ? [] : Array.isArray(locations) ? locations : [locations];
		return list.map((location) => {
			const normalized = normalizeLocation(location);
			return {
				name: symbol.name,
				kind: symbol.kind,
				path: fromUri(normalized.uri),
				uri: normalized.uri,
				range: normalized.range,
				containerName: symbol.containerName,
			};
		});
	}

	async references(path: string, symbol: ResolvedSymbolLocation): Promise<ResolvedSymbolLocation[]> {
		this.ensureProcessAlive();
		await this.openDocument(path);
		const locations = await this.request<LspLocation[] | null>("textDocument/references", {
			textDocument: { uri: toUri(path) },
			position: symbol.range.start,
			context: { includeDeclaration: true },
		});
		return (locations ?? []).map((location) => ({
			name: symbol.name,
			kind: symbol.kind,
			path: fromUri(location.uri),
			uri: location.uri,
			range: location.range,
			containerName: symbol.containerName,
		}));
	}

	resolveWorkspaceSymbol(symbol: SymbolInformation): ResolvedSymbolLocation {
		const path = fromUri(symbol.location.uri);
		return {
			name: symbol.name,
			kind: symbol.kind,
			path,
			uri: symbol.location.uri,
			range: symbol.location.range,
			containerName: symbol.containerName,
		};
	}

	readRangeSource(location: ResolvedSymbolLocation): string {
		return rangeToSource(location.path, location.range);
	}
}
