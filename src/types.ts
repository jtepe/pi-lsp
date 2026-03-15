export type SymbolAction = "search" | "definitions" | "references";

export type ServerTransport = "stdio";

export interface ServerCommandConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface LspServerConfig {
  id: string;
  name?: string;
  languages?: string[];
  fileGlobs?: string[];
  rootMarkers?: string[];
  command: ServerCommandConfig;
  initializationOptions?: unknown;
  trace?: "off" | "messages" | "verbose";
  treeSitterLanguage?: string;
}

export interface ExtensionConfig {
  servers: LspServerConfig[];
  defaultLimit?: number;
  maxLimit?: number;
  eagerInit?: boolean;
}

export interface WorkspaceMatch {
  server: LspServerConfig;
  rootPath: string;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: DocumentSymbol[];
}

export interface ResolvedSymbolLocation {
  name: string;
  kind?: number;
  path: string;
  uri: string;
  range: LspRange;
  containerName?: string;
  source?: string;
}
