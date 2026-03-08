import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createCodeSymbolsTool } from "./tool.js";
import { LspServerManager } from "./server-manager.js";
import { SourceExtractor } from "./source-extractor.js";

export default function piLspExtension(pi: ExtensionAPI) {
	const manager = new LspServerManager();
	const sourceExtractor = new SourceExtractor();

	pi.registerTool(createCodeSymbolsTool(manager, sourceExtractor));

	pi.on("session_shutdown", async () => {
		await manager.stopAll();
	});
}
