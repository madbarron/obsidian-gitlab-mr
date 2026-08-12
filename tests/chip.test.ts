// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./obsidianDom";
import { Chip, type ChipHost } from "../src/render/chip";
import type { MrStore } from "../src/cache";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { MrData, MrEntry, MrRef } from "../src/types";

beforeAll(() => {
	installObsidianDomHelpers();
});

const ref: MrRef = {
	raw: "!monkey-island/231",
	fullPath: "org/group/monkey-island",
	iid: "231",
	key: "org/group/monkey-island!231",
	start: 0,
	end: 17,
};

const ME = "guybrush";

const identity = { username: ME, canWrite: true, checkedAt: 1 };

const data: MrData = {
	fullPath: "org/group/monkey-island",
	iid: "231",
	title: "Find Big Whoop",
	state: "opened",
	draft: false,
	webUrl: "https://gitlab.com/org/group/monkey-island/-/merge_requests/231",
	unresolvedThreads: 2,
	approved: false,
	approvalsRequired: 1,
	approvalsLeft: 1,
	author: { username: "lechuck", name: "Ghost Pirate LeChuck" },
	detailedMergeStatus: "CI_MUST_PASS",
	canMerge: true,
	diffHeadSha: "abc123",
	sourceBranch: "feature/three-trials",
	targetBranch: "main",
	squashDefault: true,
	squashLocked: false,
	removeSourceBranchDefault: true,
	removeSourceBranchLocked: false,
	reviewers: [
		{ username: ME, name: "Guybrush Threepwood", reviewState: "APPROVED", approved: true },
		{ username: "elaine", name: "Elaine Marley", reviewState: "REVIEWED", approved: false },
		{ username: "sword-master", name: null, reviewState: "UNREVIEWED", approved: false },
	],
	pipeline: {
		status: "SUCCESS",
		active: false,
		failureReason: null,
		tooltip: "passed",
		label: "passed",
		detailsPath: "/org/group/monkey-island/-/pipelines/999",
	},
};

const merged: MrData[] = [];

function hostFor(entry: MrEntry, overrides: Partial<typeof DEFAULT_SETTINGS> = {}): ChipHost {
	const store = {
		get: () => entry,
		subscribe: () => () => undefined,
		refresh: () => undefined,
	} as unknown as MrStore;

	return {
		settings: { ...DEFAULT_SETTINGS, identity, ...overrides },
		store,
		openSettings: () => undefined,
		requestMerge: (data: MrData) => merged.push(data),
	};
}

function render(entry: MrEntry, overrides: Partial<typeof DEFAULT_SETTINGS> = {}): HTMLElement {
	return new Chip(hostFor(entry, overrides), ref).el;
}

function renderData(
	patch: Partial<MrData> = {},
	overrides: Partial<typeof DEFAULT_SETTINGS> = {},
): HTMLElement {
	return render({ status: "ok", data: { ...data, ...patch }, fetchedAt: Date.now() }, overrides);
}

describe("chip — loaded merge request", () => {
	const el = () => render({ status: "ok", data, fetchedAt: Date.now() });

	it("renders the requested fields in order", () => {
		const parts = Array.from(el().querySelectorAll("span, a, button"))
			.filter((node) => node.children.length === 0 && !node.classList.contains("gl-mr-dot"))
			.map((node) => node.textContent);

		expect(parts).toEqual([
			"Open",
			"GL", // author — this fixture's MR belongs to someone else
			"monkey-island/231",
			"Find Big Whoop",
			"(2)",
			"✅",
			"GT",
			"💬",
			"EM",
			"⚪",
			"SM",
		]);
	});

	it("shows the pipeline as a colored dot", () => {
		const dot = el().querySelector(".gl-mr-dot");
		expect(dot?.classList.contains("gl-mr-dot-passed")).toBe(true);
		expect(dot?.textContent).toBe("");
	});

	it("marks the state on the chip and links to the merge request", () => {
		const chip = el();
		expect(chip.classList.contains("gl-mr-state-opened")).toBe(true);
		expect(chip.querySelector("a.gl-mr-main")?.getAttribute("href")).toBe(data.webUrl);
	});

	it("links the pipeline dot to the pipeline, not the merge request", () => {
		const pipeline = el().querySelector("a.gl-mr-pipeline");
		expect(pipeline?.getAttribute("href")).toBe(
			"https://gitlab.com/org/group/monkey-island/-/pipelines/999",
		);
		expect(pipeline?.classList.contains("gl-mr-pipe-passed")).toBe(true);
		expect(pipeline?.getAttribute("title")).toBe("Pipeline: passed");
	});

	it("names each reviewer and their state in a tooltip", () => {
		const titles = Array.from(el().querySelectorAll(".gl-mr-reviewer")).map((node) =>
			node.getAttribute("title"),
		);
		expect(titles).toEqual([
			"Guybrush Threepwood — approved",
			"Elaine Marley — reviewed",
			// No display name, so the username carries the tooltip too.
			"sword-master — not reviewed yet",
		]);
	});

	it("hides the thread count when everything is resolved", () => {
		const chip = render({
			status: "ok",
			data: { ...data, unresolvedThreads: 0 },
			fetchedAt: Date.now(),
		});
		expect(chip.querySelector(".gl-mr-threads")).toBeNull();
	});

	it("omits the pipeline entirely when there is none", () => {
		const chip = render({
			status: "ok",
			data: { ...data, pipeline: null },
			fetchedAt: Date.now(),
		});
		expect(chip.querySelector(".gl-mr-pipeline")).toBeNull();
	});

	it("labels a draft merge request as Draft", () => {
		const chip = render({
			status: "ok",
			data: { ...data, draft: true },
			fetchedAt: Date.now(),
		});
		expect(chip.querySelector(".gl-mr-status")?.textContent).toBe("Draft");
		expect(chip.classList.contains("gl-mr-state-draft")).toBe(true);
	});

	it("respects the display toggles", () => {
		const chip = render({ status: "ok", data, fetchedAt: Date.now() }, {
			showTitle: false,
			showPipeline: false,
			showReviewers: false,
			showFullProjectPath: true,
		});
		expect(chip.querySelector(".gl-mr-title")).toBeNull();
		expect(chip.querySelector(".gl-mr-pipeline")).toBeNull();
		expect(chip.querySelector(".gl-mr-reviewers")).toBeNull();
		expect(chip.querySelector(".gl-mr-ref")?.textContent).toBe(
			"org/group/monkey-island/231",
		);
	});
});

describe("chip — author initials", () => {
	it("shows another author's initials with a tooltip", () => {
		const author = renderData().querySelector(".gl-mr-author");
		expect(author?.textContent).toBe("GL");
		expect(author?.getAttribute("title")).toBe("Author: Ghost Pirate LeChuck");
	});

	it("stays out of the way on my own merge requests", () => {
		const chip = renderData({ author: { username: ME, name: "Guybrush Threepwood" } });
		expect(chip.querySelector(".gl-mr-author")).toBeNull();
	});

	it("is omitted when GitLab reports no author", () => {
		expect(renderData({ author: null }).querySelector(".gl-mr-author")).toBeNull();
	});

	it("still shows the author when my identity is unknown", () => {
		const chip = renderData({}, { identity: { username: null, canWrite: false, checkedAt: 0 } });
		expect(chip.querySelector(".gl-mr-author")?.textContent).toBe("GL");
	});

	it("can be turned off", () => {
		expect(renderData({}, { showAuthor: false }).querySelector(".gl-mr-author")).toBeNull();
	});
});

describe("chip — merge button", () => {
	const mine: Partial<MrData> = {
		author: { username: ME, name: "Guybrush Threepwood" },
		detailedMergeStatus: "MERGEABLE",
		canMerge: true,
	};

	it("appears on my own mergeable merge request", () => {
		const button = renderData(mine).querySelector("button.gl-mr-merge");
		expect(button?.textContent).toBe("Merge");
		expect(button?.getAttribute("title")).toBe("Merge into main");
	});

	it("asks for confirmation instead of merging on click", () => {
		merged.length = 0;
		const button = renderData(mine).querySelector("button.gl-mr-merge") as HTMLButtonElement;
		button.click();
		// The chip only ever requests a merge; MergeConfirmModal is what talks to GitLab.
		expect(merged).toHaveLength(1);
		expect(merged[0].iid).toBe("231");
	});

	it("is hidden when the token cannot write", () => {
		const chip = renderData(mine, {
			identity: { username: ME, canWrite: false, checkedAt: 1 },
		});
		expect(chip.querySelector("button.gl-mr-merge")).toBeNull();
	});

	it("is hidden on someone else's merge request", () => {
		const chip = renderData({ ...mine, author: { username: "lechuck", name: "Ghost Pirate LeChuck" } });
		expect(chip.querySelector("button.gl-mr-merge")).toBeNull();
	});

	it("is hidden whenever GitLab does not say MERGEABLE", () => {
		for (const status of [
			"CI_MUST_PASS",
			"DISCUSSIONS_NOT_RESOLVED",
			"NOT_APPROVED",
			"CONFLICT",
			"NEED_REBASE",
			"CHECKING",
			null,
		]) {
			const chip = renderData({ ...mine, detailedMergeStatus: status });
			expect(chip.querySelector("button.gl-mr-merge")).toBeNull();
		}
	});

	it("is hidden when I lack permission, on drafts, and when closed", () => {
		expect(
			renderData({ ...mine, canMerge: false }).querySelector("button.gl-mr-merge"),
		).toBeNull();
		expect(renderData({ ...mine, draft: true }).querySelector("button.gl-mr-merge")).toBeNull();
		expect(
			renderData({ ...mine, state: "merged" }).querySelector("button.gl-mr-merge"),
		).toBeNull();
	});

	it("can be turned off in settings", () => {
		const chip = renderData(mine, { enableMergeButton: false });
		expect(chip.querySelector("button.gl-mr-merge")).toBeNull();
	});
});

describe("chip — loading and error states", () => {
	it("shows a skeleton with the reference while loading", () => {
		const chip = render({ status: "loading" });
		expect(chip.classList.contains("gl-mr-loading")).toBe(true);
		expect(chip.querySelector(".gl-mr-ref")?.textContent).toBe("monkey-island/231");
	});

	it("prompts for a token when none is configured", () => {
		const chip = render({
			status: "error",
			error: { kind: "no-token", message: "Add a token." },
			fetchedAt: Date.now(),
		});
		expect(chip.classList.contains("gl-mr-error-no-token")).toBe(true);
		expect(chip.querySelector(".gl-mr-status")?.textContent).toBe("set token");
	});

	it("surfaces auth, missing and offline failures distinctly", () => {
		const labels = (["unauthorized", "not-found", "network"] as const).map((kind) => {
			const chip = render({
				status: "error",
				error: { kind, message: `${kind} failed` },
				fetchedAt: Date.now(),
			});
			return chip.querySelector(".gl-mr-status")?.textContent;
		});
		expect(labels).toEqual(["auth", "not found", "offline"]);
	});

	it("keeps the failure message in a tooltip", () => {
		const chip = render({
			status: "error",
			error: { kind: "unauthorized", message: "GitLab rejected the token (401)." },
			fetchedAt: Date.now(),
		});
		expect(chip.querySelector(".gl-mr-main")?.getAttribute("title")).toBe(
			"GitLab rejected the token (401).",
		);
	});
});
