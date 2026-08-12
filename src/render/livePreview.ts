import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
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

function buildDecorations(host: LivePreviewHost, view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!host.settings.renderInLivePreview) return builder.finish();
	// Source mode should always show the raw text.
	if (!view.state.field(editorLivePreviewField)) return builder.finish();

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.sliceDoc(from, to);
		for (const ref of findMrRefs(text, host.parseContext)) {
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

export function createLivePreviewExtension(host: LivePreviewHost) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(host, view);
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.selectionSet ||
					update.viewportChanged ||
					update.focusChanged
				) {
					this.decorations = buildDecorations(host, update.view);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
