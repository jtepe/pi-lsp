import { readFileSync } from "node:fs";
import type { ResolvedSymbolLocation } from "./types.js";

export class SourceExtractor {
	async expandSymbolSource(
		location: ResolvedSymbolLocation,
		_serverTreeSitterLanguage: string | undefined,
	): Promise<string | undefined> {
		const fileText = readFileSync(location.path, "utf8");
		return this.sliceRange(fileText, location.range);
	}

	private sliceRange(
		text: string,
		range: { start: { line: number; character: number }; end: { line: number; character: number } },
	): string {
		const lines = text.split("\n");
		let startOffset = 0;
		for (let index = 0; index < range.start.line; index++) {
			startOffset += (lines[index] ?? "").length + 1;
		}
		startOffset += range.start.character;
		let endOffset = 0;
		for (let index = 0; index < range.end.line; index++) {
			endOffset += (lines[index] ?? "").length + 1;
		}
		endOffset += range.end.character;
		return text.slice(startOffset, endOffset);
	}
}
