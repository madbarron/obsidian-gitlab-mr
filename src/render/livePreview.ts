import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Text } from "@codemirror/state";
import {
	Decoration,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { findMrRefs, type ParseContext } from "../parser";
import type { MrRef } from "../types";
import { Chip, type ChipHost } from "./chip";

export interface LivePreviewHost extends ChipHost {
	parseContext: ParseContext;
}

/**
 * CodeMirror keeps widget DOM alive across rebuilds when `eq()` matches, so the chip
 * that owns a subscription is looked up by its element rather than held on the widget.
 */
const chipsByDom = new WeakMap<HTMLElement, Chip>();

class ChipWidget extends WidgetType {
	constructor(
		private host: LivePreviewHost,
		private ref: MrRef,
	) {
		super();
	}

	eq(other: ChipWidget): boolean {
		return other.ref.key === this.ref.key && other.ref.raw === this.ref.raw;
	}

	toDOM(): HTMLElement {
		const chip = new Chip(this.host, this.ref);
		chipsByDom.set(chip.el, chip);
		return chip.el;
	}

	destroy(dom: HTMLElement): void {
		chipsByDom.get(dom)?.destroy();
		chipsByDom.delete(dom);
	}

	/** Let clicks reach our own handlers instead of moving the cursor. */
	ignoreEvent(): boolean {
		return true;
	}
}

function overlapsSelection(view: EditorView, from: number, to: number): boolean {
	return view.state.selection.ranges.some(
		(range) => range.from <= to && range.to >= from,
	);
}

function isInCode(view: EditorView, pos: number): boolean {
	const node = syntaxTree(view.state).resolveInner(pos, 1);
	for (let current: typeof node | null = node; current; current = current.parent) {
		if (/code|frontmatter|math/i.test(current.name)) return true;
	}
	return false;
}

/**
 * `cache` memoizes `findMrRefs` per visible range so selection/scroll rebuilds — which
 * happen while the document is unchanged — never re-run the scanner. The caller clears it
 * whenever the document changes.
 */
function buildDecorations(
	host: LivePreviewHost,
	view: EditorView,
	cache: Map<string, MrRef[]>,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!host.settings.renderInLivePreview) return builder.finish();
	// Source mode should always show the raw text.
	if (!view.state.field(editorLivePreviewField)) return builder.finish();

	for (const { from, to } of view.visibleRanges) {
		const key = `${from}:${to}`;
		let refs = cache.get(key);
		if (!refs) {
			refs = findMrRefs(view.state.sliceDoc(from, to), host.parseContext);
			cache.set(key, refs);
		}
		for (const ref of refs) {
			const start = from + ref.start;
			const end = from + ref.end;
			// Cursor inside (or touching) the reference means the user is editing it.
			if (overlapsSelection(view, start, end)) continue;
			if (isInCode(view, start)) continue;
			builder.add(start, end, Decoration.replace({ widget: new ChipWidget(host, ref) }));
		}
	}
	return builder.finish();
}

/** Typing re-parses at most this often; below it, chips are just remapped across the edit. */
const REBUILD_DEBOUNCE_MS = 150;

export function createLivePreviewExtension(host: LivePreviewHost) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private cache = new Map<string, MrRef[]>();
			private cachedDoc: Text | null = null;
			private rebuildTimer: number | null = null;

			constructor(view: EditorView) {
				this.decorations = this.rebuild(view);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) {
					// Keep chips positioned across the edit and defer the re-parse, so holding a
					// key down does not run the scanner on every keystroke.
					this.decorations = this.decorations.map(update.changes);
					this.scheduleRebuild(update.view);
				} else if (
					update.selectionSet ||
					update.viewportChanged ||
					update.focusChanged
				) {
					// The document is unchanged here, so this reuses the parse cache and stays
					// responsive — it is what flips a reference between chip and raw text.
					this.decorations = this.rebuild(update.view);
				}
			}

			destroy(): void {
				if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
				this.rebuildTimer = null;
			}

			private scheduleRebuild(view: EditorView): void {
				if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
				this.rebuildTimer = window.setTimeout(() => {
					this.rebuildTimer = null;
					this.decorations = this.rebuild(view);
					// The set changed outside an update cycle; an empty transaction makes
					// CodeMirror re-pull it.
					view.dispatch({});
				}, REBUILD_DEBOUNCE_MS);
			}

			/** Build decorations, dropping the parse cache when the document has changed. */
			private rebuild(view: EditorView): DecorationSet {
				if (this.cachedDoc !== view.state.doc) {
					this.cache.clear();
					this.cachedDoc = view.state.doc;
				}
				return buildDecorations(host, view, this.cache);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
