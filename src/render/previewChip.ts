import type { MrStore } from "../cache";
import type { GitLabMrSettings } from "../settings";
import type { MrData, MrEntry, MrRef } from "../types";
import { Chip, type ChipHost } from "./chip";

/**
 * A sample merge request for the settings preview. It belongs to someone else (so the author
 * pill is demoed) and carries a title well past the maximum length (so truncation shows). The
 * merge button never appears here — it only shows on your own merge requests.
 */
const PREVIEW_REF: MrRef = {
	raw: "!monkey-island/231",
	fullPath: "org/group/monkey-island",
	iid: "231",
	key: "org/group/monkey-island!231",
	start: 0,
	end: 18,
};

const PREVIEW_DATA: MrData = {
	fullPath: "org/group/monkey-island",
	iid: "231",
	title:
		"Refactor the grog inventory service to stream barrels lazily, add retries around the flaky dockside supplier API, and cache the manifest before the festival",
	state: "opened",
	draft: false,
	webUrl: "https://gitlab.com/org/group/monkey-island/-/merge_requests/231",
	unresolvedThreads: 2,
	approved: false,
	approvalsRequired: 1,
	approvalsLeft: 1,
	author: { username: "lechuck", name: "Ghost Pirate LeChuck" },
	reviewers: [
		{ username: "elaine", name: "Elaine Marley", reviewState: "APPROVED", approved: true },
		{ username: "sword-master", name: "Sword Master", reviewState: "REVIEWED", approved: false },
	],
	pipeline: {
		status: "SUCCESS",
		active: false,
		failureReason: null,
		tooltip: "passed",
		label: "passed",
		detailsPath: null,
	},
	detailedMergeStatus: "MERGEABLE",
	canMerge: false,
	diffHeadSha: "abc123",
	sourceBranch: "feature/grog-inventory",
	targetBranch: "main",
	squashDefault: true,
	squashLocked: false,
	removeSourceBranchDefault: true,
	removeSourceBranchLocked: false,
};

/** A one-entry store that always yields the sample MR, so the preview reuses the real Chip. */
class PreviewStore {
	private listener: (() => void) | null = null;

	get(): MrEntry {
		return { status: "ok", data: PREVIEW_DATA, fetchedAt: Date.now() };
	}

	subscribe(_key: string, listener: () => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = null;
		};
	}

	refresh(): void {}

	/** Repaint the preview chip so it reflects the latest display settings. */
	repaint(): void {
		this.listener?.();
	}
}

export interface PreviewChip {
	el: HTMLElement;
	/** Re-render the chip from the (live) settings object it was given. */
	repaint(): void;
	destroy(): void;
}

/**
 * Build a live preview chip for the settings tab. `settings` must be the plugin's own settings
 * object so that mutating it in place and calling `repaint()` reflects the change immediately.
 */
export function createPreviewChip(settings: GitLabMrSettings): PreviewChip {
	const store = new PreviewStore();
	const host: ChipHost = {
		settings,
		store: store as unknown as MrStore,
		openSettings: () => {},
		requestMerge: () => {},
	};
	const chip = new Chip(host, PREVIEW_REF);
	return {
		el: chip.el,
		repaint: () => store.repaint(),
		destroy: () => chip.destroy(),
	};
}
