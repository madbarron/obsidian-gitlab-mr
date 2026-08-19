import type {
	Identity,
	MergeRequestState,
	MrData,
	PipelineInfo,
	PipelineStatus,
	ReviewState,
} from "./types";

export interface GlyphView {
	glyph: string;
	label: string;
	/** Suffix for the `gl-mr-*` CSS class that carries the color. */
	modifier: string;
}

/** Pipeline indicators are CSS-drawn dots, so they carry no glyph — only a color. */
export interface DotView {
	label: string;
	modifier: string;
}

export interface StatusView {
	label: string;
	modifier: string;
}

const STATE_LABELS: Record<MergeRequestState, StatusView> = {
	opened: { label: "Open", modifier: "opened" },
	merged: { label: "Merged", modifier: "merged" },
	closed: { label: "Closed", modifier: "closed" },
	locked: { label: "Locked", modifier: "locked" },
};

/** Draft wins over `opened`: a draft MR is not ready either way. */
export function statusView(state: string, draft: boolean): StatusView {
	if (draft && state === "opened") return { label: "Draft", modifier: "draft" };
	return STATE_LABELS[state as MergeRequestState] ?? { label: state, modifier: "unknown" };
}

const PIPELINE_VIEWS: Record<PipelineStatus, DotView> = {
	SUCCESS: { label: "passed", modifier: "passed" },
	FAILED: { label: "failed", modifier: "failed" },
	RUNNING: { label: "running", modifier: "running" },
	CREATED: { label: "waiting", modifier: "waiting" },
	PENDING: { label: "waiting", modifier: "waiting" },
	PREPARING: { label: "waiting", modifier: "waiting" },
	WAITING_FOR_RESOURCE: { label: "waiting", modifier: "waiting" },
	WAITING_FOR_CALLBACK: { label: "waiting", modifier: "waiting" },
	SCHEDULED: { label: "scheduled", modifier: "waiting" },
	MANUAL: { label: "paused", modifier: "paused" },
	CANCELED: { label: "canceled", modifier: "canceled" },
	CANCELING: { label: "canceling", modifier: "canceled" },
	SKIPPED: { label: "skipped", modifier: "skipped" },
};

/** Unknown statuses degrade to a neutral dot rather than disappearing. */
export function pipelineDot(status: string): DotView {
	return (
		PIPELINE_VIEWS[status as PipelineStatus] ?? {
			label: status.toLowerCase().replace(/_/g, " "),
			modifier: "unknown",
		}
	);
}

/** GitLab's own wording wins; ours is the fallback. */
export function pipelineTooltip(pipeline: PipelineInfo): string {
	const view = pipelineDot(pipeline.status);
	const base = pipeline.tooltip || pipeline.label || view.label;
	return pipeline.failureReason
		? `Pipeline: ${base} — ${pipeline.failureReason.replace(/_/g, " ")}`
		: `Pipeline: ${base}`;
}

const REVIEW_VIEWS: Record<ReviewState, GlyphView> = {
	APPROVED: { glyph: "✅", label: "approved", modifier: "approved" },
	REQUESTED_CHANGES: { glyph: "❗", label: "requested changes", modifier: "changes" },
	REVIEWED: { glyph: "💬", label: "reviewed", modifier: "reviewed" },
	REVIEW_STARTED: { glyph: "👀", label: "review started", modifier: "started" },
	UNREVIEWED: { glyph: "⚪", label: "not reviewed yet", modifier: "unreviewed" },
	UNAPPROVED: { glyph: "⚪", label: "approval removed", modifier: "unreviewed" },
};

export function reviewView(state: ReviewState | string | null): GlyphView {
	if (!state) return REVIEW_VIEWS.UNREVIEWED;
	return REVIEW_VIEWS[state as ReviewState] ?? REVIEW_VIEWS.UNREVIEWED;
}

/** `Guybrush Threepwood` -> `GT`, `guybrush.threepwood` -> `GT`, `Guybrush` -> `GU`. */
export function initials(name: string | null, username: string): string {
	const source = (name || username || "").trim();
	if (!source) return "?";

	const words = source.split(/[\s._-]+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function truncate(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Only `http`/`https` URLs are safe to put in an `href` or hand to `window.open`. A
 * compromised or misconfigured GitLab instance could return a `javascript:` `webUrl`, which
 * would otherwise run on middle-click or via `window.open`. Returns null for anything else.
 */
export function safeUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const protocol = new URL(url).protocol;
		return protocol === "http:" || protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

/** `org/group/project` -> `project`. */
export function shortProject(fullPath: string): string {
	const segments = fullPath.split("/").filter(Boolean);
	return segments.length ? segments[segments.length - 1] : fullPath;
}

export function refLabel(fullPath: string, iid: string, showFullPath: boolean): string {
	return `${showFullPath ? fullPath : shortProject(fullPath)}/${iid}`;
}

/** The author pill is noise on your own merge requests, which are most of them. */
export function shouldShowAuthor(data: MrData, identity: Identity): boolean {
	if (!data.author) return false;
	// With no known identity we cannot tell whose it is, so show it rather than drop data.
	if (!identity.username) return true;
	return data.author.username !== identity.username;
}

/**
 * Every condition that must hold before the chip offers a merge. Deliberately strict: your
 * own open non-draft merge request, GitLab already calling it MERGEABLE, you allowed to
 * merge it, and a token that provably can write.
 */
export function canOfferMerge(
	data: MrData,
	options: { enabled: boolean; identity: Identity },
): boolean {
	if (!options.enabled) return false;
	if (!options.identity.canWrite || !options.identity.username) return false;
	if (!data.author || data.author.username !== options.identity.username) return false;
	if (data.state !== "opened" || data.draft) return false;
	if (data.detailedMergeStatus !== "MERGEABLE") return false;
	return data.canMerge;
}
