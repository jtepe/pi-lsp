import { resolve } from "node:path";
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { clampLimit, loadConfig, matchServer } from "./config.js";
import type { ExtensionConfig, ResolvedSymbolLocation, SymbolAction } from "./types.js";
import { LspServerManager } from "./server-manager.js";

const codeSymbolsParameters = Type.Object({
	action: StringEnum(["search", "definitions", "references"] as const),
	name: Type.String({ description: "Symbol name or search query" }),
	filePath: Type.Optional(Type.String({ description: "File path used for server selection and symbol resolution" })),
	language: Type.Optional(Type.String({ description: "Language override for server selection" })),
	serverId: Type.Optional(Type.String({ description: "Explicit LSP server id from .pi/lsp.json" })),
	includeSource: Type.Optional(Type.Boolean({ description: "Include source code snippets in results" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results to return" })),
});

type CodeSymbolsParams = {
	action: SymbolAction;
	name: string;
	filePath?: string;
	language?: string;
	serverId?: string;
	includeSource?: boolean;
	limit?: number;
};

interface SourceExtractor {
	expandSymbolSource(location: ResolvedSymbolLocation, serverTreeSitterLanguage: string | undefined): Promise<string | undefined>;
}

function normalizeQuery(query: string): string {
	if (!query.includes("*") && !query.includes("?")) {
		return `*${query}*`;
	}
	return query;
}

function wildcardToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i");
}

function formatLocation(location: ResolvedSymbolLocation): string {
	return `${location.path}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatResultBlock(location: ResolvedSymbolLocation): string {
	let line = `- ${location.name} -> ${formatLocation(location)}`;
	if (location.containerName) {
		line += ` (${location.containerName})`;
	}
	if (location.source) {
		line += `\n\`\`\`\n${location.source}\n\`\`\``;
	}
	return line;
}

async function attachSource(
	locations: ResolvedSymbolLocation[],
	includeSource: boolean | undefined,
	sourceExtractor: SourceExtractor,
	serverTreeSitterLanguage: string | undefined,
): Promise<ResolvedSymbolLocation[]> {
	if (!includeSource) {
		return locations;
	}
	const result: ResolvedSymbolLocation[] = [];
	for (const location of locations) {
		const source = await sourceExtractor.expandSymbolSource(location, serverTreeSitterLanguage);
		result.push({ ...location, source });
	}
	return result;
}

async function findDocumentSymbolCandidate(
	config: ExtensionConfig,
	manager: LspServerManager,
	cwd: string,
	params: CodeSymbolsParams,
): Promise<{ candidate: ResolvedSymbolLocation; treeSitterLanguage: string | undefined }> {
	if (!params.filePath) {
		throw new Error(`${params.action} requires filePath`);
	}
	const absolutePath = resolve(cwd, params.filePath);
	const { client, match } = await manager.getClient(config, cwd, {
		filePath: absolutePath,
		language: params.language,
		serverId: params.serverId,
	});
	const candidates = await client.documentSymbols(absolutePath);
	const matcher = wildcardToRegExp(normalizeQuery(params.name));
	const candidate = candidates.find((item) => matcher.test(item.name));
	if (!candidate) {
		throw new Error(`No document symbol matching "${params.name}" found in ${params.filePath}`);
	}
	return { candidate, treeSitterLanguage: match.server.treeSitterLanguage };
}

export function createCodeSymbolsTool(
	manager: LspServerManager,
	sourceExtractor: SourceExtractor,
): ToolDefinition<typeof codeSymbolsParameters, { serverId: string; rootPath: string; count: number }> {
	return {
		name: "code_symbols",
		label: "Code Symbols",
		description: "Search symbols and resolve definitions or references through configured LSP servers.",
		promptSnippet: "Search code symbols, definitions, and references using project-configured LSP servers.",
		promptGuidelines: [
			"Use code_symbols for semantic symbol lookup before falling back to grep-based code search.",
			"Partial names work: searching 'run' matches 'runTask'. For definitions and references, use wildcards (* and ?) for finer control like 'run*' (prefix) or '*Task' (suffix).",
			"Pass includeSource only when the source snippet is needed, to keep context compact.",
		],
		parameters: codeSymbolsParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const config = loadConfig(ctx.cwd);
			const limit = clampLimit(config, params.limit);
			if (params.action === "search") {
				const selection = matchServer(config, ctx.cwd, {
					filePath: params.filePath,
					language: params.language,
					serverId: params.serverId,
				});
				const { client } = await manager.getClient(config, ctx.cwd, {
					filePath: params.filePath,
					language: params.language,
					serverId: params.serverId,
				});
				const locations = (await client.workspaceSymbols(params.name))
					.slice(0, limit)
					.map((symbol) => client.resolveWorkspaceSymbol(symbol));
				const withSource = await attachSource(
					locations,
					params.includeSource,
					sourceExtractor,
					selection.server.treeSitterLanguage,
				);
				const text =
					withSource.length === 0
						? `No symbols matching "${params.name}" found`
						: withSource.map((location) => formatResultBlock(location)).join("\n");
				return {
					content: [{ type: "text", text }],
					details: {
						serverId: selection.server.id,
						rootPath: selection.rootPath,
						count: withSource.length,
					},
				};
			}

			const { candidate, treeSitterLanguage } = await findDocumentSymbolCandidate(config, manager, ctx.cwd, params);
			const { client, match } = await manager.getClient(config, ctx.cwd, {
				filePath: params.filePath,
				language: params.language,
				serverId: params.serverId,
			});
			const resolved =
				params.action === "definitions"
					? await client.definition(resolve(ctx.cwd, params.filePath!), candidate)
					: await client.references(resolve(ctx.cwd, params.filePath!), candidate);
			const withSource = await attachSource(
				resolved.slice(0, limit),
				params.includeSource,
				sourceExtractor,
				treeSitterLanguage,
			);
			const text =
				withSource.length === 0
					? `No ${params.action} found for "${params.name}"`
					: withSource.map((location) => formatResultBlock(location)).join("\n");
			return {
				content: [{ type: "text", text }],
				details: {
					serverId: match.server.id,
					rootPath: match.rootPath,
					count: withSource.length,
				},
			};
		},
	};
}
