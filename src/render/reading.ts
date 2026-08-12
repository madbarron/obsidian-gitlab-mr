import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import { findMrRefs, parseMrUrl, type ParseContext } from "../parser";
import { Chip, type ChipHost } from "./chip";

export interface ReadingHost extends ChipHost {
	parseContext: ParseContext;
}

/** Ties a chip's lifetime to the rendered section so subscriptions are released. */
class ChipRenderChild extends MarkdownRenderChild {
	constructor(private chip: Chip) {
		super(chip.el);
	}

	onunload(): void {
		this.chip.destroy();
	}
}

function attach(ctx: MarkdownPostProcessorContext, chip: Chip): void {
	ctx.addChild(new ChipRenderChild(chip));
}

/**
 * Reading mode has already turned bare URLs into anchors, so we handle those directly
 * and only walk text nodes for the `!project/iid` shorthand.
 */
export function createReadingProcessor(host: ReadingHost) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		replaceAnchors(host, el, ctx);
		replaceTextNodes(host, el, ctx);
	};
}

function replaceAnchors(
	host: ReadingHost,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const anchors = Array.from(el.querySelectorAll("a")) as HTMLAnchorElement[];
	for (const anchor of anchors) {
		if (anchor.closest(".gl-mr-chip")) continue;

		const href = anchor.getAttribute("href") ?? "";
		if (!/^https?:\/\//i.test(href)) continue;

		// Only bare links become chips; `[label](url)` keeps its label.
		const text = (anchor.textContent ?? "").trim();
		const bare = text === href || text === href.replace(/^https?:\/\//i, "");
		if (!bare) continue;

		const ref = parseMrUrl(href, host.parseContext);
		if (!ref) continue;

		const chip = new Chip(host, ref);
		anchor.replaceWith(chip.el);
		attach(ctx, chip);
	}
}

function replaceTextNodes(
	host: ReadingHost,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node) {
			const parent = (node as Text).parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			// Code spans and fences are the escape hatch for literal references.
			if (parent.closest("code, pre, a, .gl-mr-chip")) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const candidates: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const value = (node as Text).nodeValue ?? "";
		// Cheap pre-filter: shorthand needs a `!`, a raw URL that escaped auto-linking
		// still contains the merge request path.
		if (value.includes("!") || value.includes("/-/merge_requests/")) {
			candidates.push(node as Text);
		}
	}

	for (const node of candidates) {
		const text = node.nodeValue ?? "";
		const refs = findMrRefs(text, host.parseContext);
		if (refs.length === 0) continue;

		const fragment = document.createDocumentFragment();
		let cursor = 0;
		for (const ref of refs) {
			if (ref.start < cursor) continue;
			if (ref.start > cursor) {
				fragment.appendChild(document.createTextNode(text.slice(cursor, ref.start)));
			}
			const chip = new Chip(host, ref);
			fragment.appendChild(chip.el);
			attach(ctx, chip);
			cursor = ref.end;
		}
		if (cursor < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(cursor)));
		}
		node.replaceWith(fragment);
	}
}
