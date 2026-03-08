import { resolve } from "node:path";
import { LspClient } from "./lsp-client.js";
import type { ExtensionConfig, WorkspaceMatch } from "./types.js";
import { matchServer } from "./config.js";

function createShutdownHook(handler: () => void): () => void {
	const wrapped = () => {
		handler();
	};
	process.once("exit", wrapped);
	process.once("SIGINT", wrapped);
	process.once("SIGTERM", wrapped);
	process.once("uncaughtException", wrapped);
	return () => {
		process.off("exit", wrapped);
		process.off("SIGINT", wrapped);
		process.off("SIGTERM", wrapped);
		process.off("uncaughtException", wrapped);
	};
}

export class LspServerManager {
	private readonly clients = new Map<string, Promise<LspClient>>();
	private readonly removeShutdownHook: () => void;

	constructor() {
		this.removeShutdownHook = createShutdownHook(() => {
			void this.stopAll();
		});
	}

	async getClient(
		config: ExtensionConfig,
		cwd: string,
		options: { filePath?: string; language?: string; serverId?: string },
	): Promise<{ client: LspClient; match: WorkspaceMatch }> {
		const normalizedPath = options.filePath ? resolve(cwd, options.filePath) : undefined;
		const match = matchServer(config, cwd, { ...options, filePath: normalizedPath });
		const key = `${match.server.id}:${match.rootPath}`;
		let clientPromise = this.clients.get(key);
		if (!clientPromise) {
			clientPromise = LspClient.start(match);
			this.clients.set(key, clientPromise);
			clientPromise.catch(() => {
				this.clients.delete(key);
			});
		}
		return { client: await clientPromise, match };
	}

	async stopAll(): Promise<void> {
		this.removeShutdownHook();
		const clients = Array.from(this.clients.values());
		this.clients.clear();
		await Promise.all(
			clients.map(async (clientPromise) => {
				try {
					const client = await clientPromise;
					await client.stop();
				} catch {}
			}),
		);
	}
}
