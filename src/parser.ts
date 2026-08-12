import type { MrRef } from "./types";

export interface ParseContext {
	/** Normalized base URL, e.g. `https://gitlab.com`. */
	baseUrl: string;
	/** Normalized group base, e.g. `org/group` (may be empty). */
	groupBase: string;
}

export const DEFAULT_BASE_URL = "https://gitlab.com";

/** Trim whitespace and trailing slashes; fall back to gitlab.com when blank. */
export function normalizeBaseUrl(value: string): string {
	const trimmed = (value ?? "").trim().replace(/\/+$/, "");
	return trimmed || DEFAULT_BASE_URL;
}

/** `/org/group/` -> `org/group`. */
export function normalizeGroupBase(value: string): string {
	return (value ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function hostOf(baseUrl: string): string | null {
	try {
		return new URL(baseUrl).host.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * A merge request URL. The `(?<!\]\()` guard keeps us from replacing the target of a
 * markdown link like `[see this](https://.../merge_requests/1)`, whose visible text is
 * the label, not the URL.
 */
const MR_URL_RE =
	/(?<!\]\()https?:\/\/([^\s/?#<>()[\]"'`]+)\/([^\s?#<>()[\]"'`]+?)\/-\/merge_requests\/(\d+)([^\s<>()[\]"'`]*)/gi;

/**
 * Shorthand `!project/iid`, `!group/project/iid` (relative to the group base) or
 * `!/full/path/iid` (absolute). The lookbehind stops it firing mid-word (`foo!bar/1`)
 * and the lookahead stops partial number matches (`!a/12x`).
 */
const MR_SHORT_RE =
	/(?<![\w`!/])!(\/?)([A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*)\/(\d+)(?![\w/])/g;

/** Characters that are almost always sentence punctuation rather than part of a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function cleanPath(value: string): string {
	return value.replace(/^\/+|\/+$/g, "");
}

function resolveShorthand(
	path: string,
	absolute: boolean,
	groupBase: string,
): string {
	const clean = cleanPath(path);
	if (absolute || !groupBase) return clean;
	return `${groupBase}/${clean}`;
}

function makeRef(
	raw: string,
	fullPath: string,
	iid: string,
	start: number,
): MrRef {
	return { raw, fullPath, iid, key: `${fullPath}!${iid}`, start, end: start + raw.length };
}

/**
 * Parse a single URL into a reference, or return null when it is not a merge request
 * URL on the configured instance. Used for auto-linked anchors in reading mode.
 */
export function parseMrUrl(url: string, ctx: ParseContext): MrRef | null {
	MR_URL_RE.lastIndex = 0;
	const match = MR_URL_RE.exec(url);
	if (!match || match.index !== 0) return null;

	const expectedHost = hostOf(ctx.baseUrl);
	if (expectedHost && match[1].toLowerCase() !== expectedHost) return null;

	const fullPath = cleanPath(match[2]);
	if (!fullPath) return null;
	return makeRef(match[0], fullPath, match[3], 0);
}

/** Find every merge request reference in a block of text, ordered by position. */
export function findMrRefs(text: string, ctx: ParseContext): MrRef[] {
	const refs: MrRef[] = [];
	const urlRanges: Array<[number, number]> = [];
	const expectedHost = hostOf(ctx.baseUrl);

	MR_URL_RE.lastIndex = 0;
	for (let m = MR_URL_RE.exec(text); m; m = MR_URL_RE.exec(text)) {
		urlRanges.push([m.index, m.index + m[0].length]);
		if (expectedHost && m[1].toLowerCase() !== expectedHost) continue;

		const fullPath = cleanPath(m[2]);
		if (!fullPath) continue;

		// A trailing `.` or `)` belongs to the sentence, not the URL.
		const raw = m[0].replace(TRAILING_PUNCTUATION, "");
		refs.push(makeRef(raw, fullPath, m[3], m.index));
	}

	MR_SHORT_RE.lastIndex = 0;
	for (let m = MR_SHORT_RE.exec(text); m; m = MR_SHORT_RE.exec(text)) {
		const start = m.index;
		const inUrl = urlRanges.some(([from, to]) => start >= from && start < to);
		if (inUrl) continue;

		const fullPath = resolveShorthand(m[2], m[1] === "/", ctx.groupBase);
		if (!fullPath) continue;
		refs.push(makeRef(m[0], fullPath, m[3], start));
	}

	return refs.sort((a, b) => a.start - b.start);
}

/** Web URL for a reference, used as a fallback before data arrives. */
export function mrWebUrl(ref: MrRef, baseUrl: string): string {
	return `${normalizeBaseUrl(baseUrl)}/${ref.fullPath}/-/merge_requests/${ref.iid}`;
}
