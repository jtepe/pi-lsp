import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, serversForWorkspace } from "./config.js";
import { createCodeSymbolsTool } from "./tool.js";
import { LspServerManager } from "./server-manager.js";
import { SourceExtractor } from "./source-extractor.js";

export default function piLspExtension(pi: ExtensionAPI) {
  const manager = new LspServerManager();
  const sourceExtractor = new SourceExtractor();

  pi.registerTool(createCodeSymbolsTool(manager, sourceExtractor));

  pi.on("session_directory", (event): undefined => {
    try {
      const config = loadConfig(event.cwd);
      if (!config.eagerInit) return;
      for (const server of serversForWorkspace(config, event.cwd)) {
        manager
          .getClient(config, event.cwd, { serverId: server.id })
          .catch(() => {});
      }
    } catch {}
    return undefined;
  });

  pi.on("session_shutdown", async () => {
    await manager.stopAll();
  });
}
