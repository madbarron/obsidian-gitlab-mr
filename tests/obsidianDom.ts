/**
 * Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement and the global
 * scope. The chip renderer uses those helpers and nothing else from Obsidian, so this
 * is enough to render and assert on a real chip in jsdom.
 */
interface ElementInfo {
	cls?: string;
	text?: string;
	href?: string;
	attr?: Record<string, string>;
}

function applyInfo(el: HTMLElement, info?: ElementInfo): HTMLElement {
	if (!info) return el;
	if (info.cls) el.className = info.cls;
	if (info.text !== undefined) el.textContent = info.text;
	if (info.href) el.setAttribute("href", info.href);
	for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, value);
	return el;
}

export function installObsidianDomHelpers(): void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.addClass = function (this: HTMLElement, ...classes: string[]) {
		this.classList.add(...classes.flatMap((c) => c.split(/\s+/).filter(Boolean)));
	};
	proto.removeClasses = function (this: HTMLElement, classes: string[]) {
		this.classList.remove(...classes);
	};
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
	};
	proto.appendText = function (this: HTMLElement, text: string) {
		this.appendChild(document.createTextNode(text));
	};
	proto.createEl = function (this: HTMLElement, tag: string, info?: ElementInfo) {
		const child = applyInfo(document.createElement(tag), info);
		this.appendChild(child);
		return child;
	};
	proto.createSpan = function (this: HTMLElement, info?: ElementInfo) {
		return (this as unknown as { createEl(tag: string, info?: ElementInfo): HTMLElement }).createEl(
			"span",
			info,
		);
	};
	proto.createDiv = function (this: HTMLElement, info?: ElementInfo) {
		return (this as unknown as { createEl(tag: string, info?: ElementInfo): HTMLElement }).createEl(
			"div",
			info,
		);
	};

	const globals = globalThis as unknown as Record<string, unknown>;
	globals.createSpan = (info?: ElementInfo) =>
		applyInfo(document.createElement("span"), info);
	globals.createDiv = (info?: ElementInfo) => applyInfo(document.createElement("div"), info);
	globals.createEl = (tag: string, info?: ElementInfo) =>
		applyInfo(document.createElement(tag), info);
}
