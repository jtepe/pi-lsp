import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Position {
	line: number;
	character: number;
}

interface Range {
	start: Position;
	end: Position;
}

interface Location {
	uri: string;
	range: Range;
}

type JsonRpcMessage = {
	jsonrpc?: "2.0";
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
};

const logFile = process.env.FAKE_LSP_LOG_FILE;
const mode = process.env.FAKE_LSP_MODE ?? "typescript";

function log(message: string): void {
	if (!logFile) return;
	appendFileSync(logFile, `${message}\n`);
}

function send(payload: unknown): void {
	const json = JSON.stringify(payload);
	process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function createLocation(path: string, line: number, start: number, end: number): Location {
	return {
		uri: pathToFileURL(path).href,
		range: {
			start: { line, character: start },
			end: { line, character: end },
		},
	};
}

const fixtures = {
	typescript: {
		workspaceSymbol: (workspaceRoot: string) => ({
			name: "runTask",
			kind: 12,
			location: createLocation(`${workspaceRoot}/src/app.ts`, 0, 16, 23),
			containerName: "app",
		}),
		documentSymbols: [
			{
				name: "runTask",
				kind: 12,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 2, character: 1 },
				},
				selectionRange: {
					start: { line: 0, character: 16 },
					end: { line: 0, character: 23 },
				},
			},
		],
		definition: (workspaceRoot: string) => [createLocation(`${workspaceRoot}/src/app.ts`, 0, 16, 23)],
		references: (workspaceRoot: string) => [
			createLocation(`${workspaceRoot}/src/app.ts`, 0, 16, 23),
			createLocation(`${workspaceRoot}/test/app.test.ts`, 0, 0, 7),
		],
	},
	python: {
		workspaceSymbol: (workspaceRoot: string) => ({
			name: "make_widget",
			kind: 12,
			location: createLocation(`${workspaceRoot}/pkg/tool.py`, 0, 4, 15),
			containerName: "tool",
		}),
		documentSymbols: [
			{
				name: "make_widget",
				kind: 12,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 1, character: 18 },
				},
				selectionRange: {
					start: { line: 0, character: 4 },
					end: { line: 0, character: 15 },
				},
			},
		],
		definition: (workspaceRoot: string) => [createLocation(`${workspaceRoot}/pkg/tool.py`, 0, 4, 15)],
		references: (workspaceRoot: string) => [createLocation(`${workspaceRoot}/pkg/tool.py`, 0, 4, 15)],
	},
} as const;

let buffer = Buffer.alloc(0);
let contentLength: number | null = null;
let workspaceRoot = process.cwd().replace(/\\/g, "/");

function respond(message: JsonRpcMessage): void {
	if (message.method === "initialize" && message.id !== undefined) {
		const rootUri = message.params?.rootUri;
		if (typeof rootUri === "string") {
			workspaceRoot = fileURLToPath(rootUri).replace(/\\/g, "/");
		}
		log(`initialize:${mode}`);
		send({
			jsonrpc: "2.0",
			id: message.id,
			result: {
				capabilities: {
					workspaceSymbolProvider: true,
					documentSymbolProvider: true,
					definitionProvider: true,
					referencesProvider: true,
				},
			},
		});
		return;
	}

	if (message.method === "initialized") {
		log(`initialized:${mode}`);
		return;
	}

	if (message.method === "shutdown" && message.id !== undefined) {
		log(`shutdown:${mode}`);
		send({ jsonrpc: "2.0", id: message.id, result: null });
		return;
	}

	if (message.method === "exit") {
		log(`exit:${mode}`);
		process.exit(0);
	}

	if (message.method === "textDocument/didOpen") {
		log(`didOpen:${mode}`);
		return;
	}

	const fixture = fixtures[mode as keyof typeof fixtures];
	if (!fixture || message.id === undefined) {
		return;
	}

	if (message.method === "workspace/symbol") {
		log(`workspace/symbol:${mode}`);
		send({ jsonrpc: "2.0", id: message.id, result: [fixture.workspaceSymbol(workspaceRoot)] });
		return;
	}

	if (message.method === "textDocument/documentSymbol") {
		log(`documentSymbol:${mode}`);
		send({ jsonrpc: "2.0", id: message.id, result: fixture.documentSymbols });
		return;
	}

	if (message.method === "textDocument/definition") {
		log(`definition:${mode}`);
		send({ jsonrpc: "2.0", id: message.id, result: fixture.definition(workspaceRoot) });
		return;
	}

	if (message.method === "textDocument/references") {
		log(`references:${mode}`);
		send({ jsonrpc: "2.0", id: message.id, result: fixture.references(workspaceRoot) });
		return;
	}

	send({
		jsonrpc: "2.0",
		id: message.id,
		error: {
			code: -32601,
			message: `Method not implemented: ${message.method ?? "<unknown>"}`,
		},
	});
}

process.stdin.on("data", (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk]);
	while (true) {
		if (contentLength === null) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const header = buffer.subarray(0, headerEnd).toString("utf8");
			buffer = buffer.subarray(headerEnd + 4);
			const lengthLine = header
				.split("\r\n")
				.find((line) => line.toLowerCase().startsWith("content-length:"));
			contentLength = Number(lengthLine?.split(":")[1]?.trim() ?? 0);
		}
		if (contentLength === null || buffer.byteLength < contentLength) {
			return;
		}
		const payload = buffer.subarray(0, contentLength).toString("utf8");
		buffer = buffer.subarray(contentLength);
		contentLength = null;
		respond(JSON.parse(payload) as JsonRpcMessage);
	}
});
