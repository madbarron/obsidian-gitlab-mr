import { describe, expect, it } from "vitest";
import {
	canOfferMerge,
	initials,
	pipelineDot,
	pipelineTooltip,
	refLabel,
	reviewView,
	safeUrl,
	shortProject,
	shouldShowAuthor,
	statusView,
	truncate,
} from "../src/format";
import type {
	Identity,
	MrData,
	PipelineInfo,
	PipelineStatus,
	ReviewState,
} from "../src/types";

describe("statusView", () => {
	it("labels each merge request state", () => {
		expect(statusView("opened", false)).toEqual({ label: "Open", modifier: "opened" });
		expect(statusView("merged", false)).toEqual({ label: "Merged", modifier: "merged" });
		expect(statusView("closed", false)).toEqual({ label: "Closed", modifier: "closed" });
		expect(statusView("locked", false)).toEqual({ label: "Locked", modifier: "locked" });
	});

	it("prefers Draft over Open", () => {
		expect(statusView("opened", true).label).toBe("Draft");
	});

	it("does not call a merged MR a draft", () => {
		expect(statusView("merged", true).label).toBe("Merged");
	});
});

describe("pipelineDot", () => {
	const cases: Array<[PipelineStatus, string, string]> = [
		["SUCCESS", "passed", "passed"],
		["FAILED", "failed", "failed"],
		["RUNNING", "running", "running"],
		["CREATED", "waiting", "waiting"],
		["PENDING", "waiting", "waiting"],
		["PREPARING", "waiting", "waiting"],
		["WAITING_FOR_RESOURCE", "waiting", "waiting"],
		["WAITING_FOR_CALLBACK", "waiting", "waiting"],
		["SCHEDULED", "scheduled", "waiting"],
		["MANUAL", "paused", "paused"],
		["CANCELED", "canceled", "canceled"],
		["CANCELING", "canceling", "canceled"],
		["SKIPPED", "skipped", "skipped"],
	];

	it.each(cases)("maps %s to the %s dot", (status, label, modifier) => {
		const view = pipelineDot(status);
		expect(view.label).toBe(label);
		expect(view.modifier).toBe(modifier);
	});

	it("covers every value of PipelineStatusEnum", () => {
		expect(cases).toHaveLength(13);
	});

	it("degrades gracefully for an unknown status", () => {
		const view = pipelineDot("SOME_NEW_STATE");
		expect(view.modifier).toBe("unknown");
		expect(view.label).toBe("some new state");
	});
});

describe("pipelineTooltip", () => {
	const base: PipelineInfo = {
		status: "FAILED",
		active: false,
		failureReason: null,
		tooltip: null,
		label: null,
		detailsPath: null,
	};

	it("prefers GitLab's own wording", () => {
		expect(pipelineTooltip({ ...base, tooltip: "failed - job failed" })).toBe(
			"Pipeline: failed - job failed",
		);
		expect(pipelineTooltip({ ...base, label: "failed" })).toBe("Pipeline: failed");
	});

	it("falls back to our label and appends the failure reason", () => {
		expect(pipelineTooltip({ ...base, failureReason: "job_failure" })).toBe(
			"Pipeline: failed — job failure",
		);
	});
});

describe("reviewView", () => {
	const cases: Array<[ReviewState, string, string]> = [
		["APPROVED", "✅", "approved"],
		["REQUESTED_CHANGES", "❗", "changes"],
		["REVIEWED", "💬", "reviewed"],
		["REVIEW_STARTED", "👀", "started"],
		["UNREVIEWED", "⚪", "unreviewed"],
		["UNAPPROVED", "⚪", "unreviewed"],
	];

	it.each(cases)("maps %s to %s", (state, glyph, modifier) => {
		const view = reviewView(state);
		expect(view.glyph).toBe(glyph);
		expect(view.modifier).toBe(modifier);
	});

	it("treats a missing review state as unreviewed", () => {
		expect(reviewView(null).glyph).toBe("⚪");
		expect(reviewView("SOMETHING_NEW").glyph).toBe("⚪");
	});
});

describe("initials", () => {
	it("uses first and last name", () => {
		expect(initials("Guybrush Threepwood", "guybrush")).toBe("GT");
		expect(initials("Ada B. Lovelace", "ada")).toBe("AL");
	});

	it("handles username-shaped names", () => {
		expect(initials("guybrush.threepwood", "guybrush")).toBe("GT");
		expect(initials("elaine-marley", "elaine")).toBe("EM");
	});

	it("falls back to two letters, then to the username", () => {
		expect(initials("Guybrush", "guybrush")).toBe("GU");
		expect(initials(null, "svc-bot")).toBe("SB");
		expect(initials("", "")).toBe("?");
	});
});

describe("truncate", () => {
	it("leaves short text alone", () => {
		expect(truncate("short title", 60)).toBe("short title");
	});

	it("adds an ellipsis and trims trailing spaces", () => {
		expect(truncate("Example of using playwright e2e testing", 12)).toBe("Example of…");
		expect(truncate("abcdefghij", 5)).toBe("abcd…");
	});
});

describe("shouldShowAuthor", () => {
	const me: Identity = { username: "guybrush", canWrite: false, checkedAt: 1 };
	const withAuthor = (username: string | null) =>
		({ author: username ? { username, name: null } : null }) as MrData;

	it("hides my own merge requests and shows everyone else's", () => {
		expect(shouldShowAuthor(withAuthor("guybrush"), me)).toBe(false);
		expect(shouldShowAuthor(withAuthor("lechuck"), me)).toBe(true);
	});

	it("shows the author when there is no known identity", () => {
		const unknown: Identity = { username: null, canWrite: false, checkedAt: 0 };
		expect(shouldShowAuthor(withAuthor("guybrush"), unknown)).toBe(true);
	});

	it("shows nothing when GitLab reports no author", () => {
		expect(shouldShowAuthor(withAuthor(null), me)).toBe(false);
	});
});

describe("canOfferMerge", () => {
	const identity: Identity = { username: "guybrush", canWrite: true, checkedAt: 1 };
	const mine = {
		author: { username: "guybrush", name: "Guybrush Threepwood" },
		state: "opened",
		draft: false,
		detailedMergeStatus: "MERGEABLE",
		canMerge: true,
	} as MrData;

	it("allows my own mergeable merge request", () => {
		expect(canOfferMerge(mine, { enabled: true, identity })).toBe(true);
	});

	it("refuses when disabled, read-only, or identity is unknown", () => {
		expect(canOfferMerge(mine, { enabled: false, identity })).toBe(false);
		expect(
			canOfferMerge(mine, { enabled: true, identity: { ...identity, canWrite: false } }),
		).toBe(false);
		expect(
			canOfferMerge(mine, { enabled: true, identity: { ...identity, username: null } }),
		).toBe(false);
	});

	it("refuses other people's merge requests", () => {
		const theirs = { ...mine, author: { username: "lechuck", name: null } } as MrData;
		expect(canOfferMerge(theirs, { enabled: true, identity })).toBe(false);
		expect(canOfferMerge({ ...mine, author: null } as MrData, { enabled: true, identity })).toBe(
			false,
		);
	});

	it("refuses anything GitLab has not called MERGEABLE", () => {
		for (const status of ["CI_MUST_PASS", "NOT_APPROVED", "CONFLICT", "CHECKING", null]) {
			const blocked = { ...mine, detailedMergeStatus: status } as MrData;
			expect(canOfferMerge(blocked, { enabled: true, identity })).toBe(false);
		}
	});

	it("refuses drafts, non-open states and missing permission", () => {
		expect(canOfferMerge({ ...mine, draft: true } as MrData, { enabled: true, identity })).toBe(
			false,
		);
		expect(
			canOfferMerge({ ...mine, state: "merged" } as MrData, { enabled: true, identity }),
		).toBe(false);
		expect(canOfferMerge({ ...mine, canMerge: false } as MrData, { enabled: true, identity })).toBe(
			false,
		);
	});
});

describe("safeUrl", () => {
	it("passes http and https URLs through", () => {
		expect(safeUrl("https://gitlab.com/a/b/-/merge_requests/1")).toBe(
			"https://gitlab.com/a/b/-/merge_requests/1",
		);
		expect(safeUrl("http://localhost/x")).toBe("http://localhost/x");
	});

	it("rejects javascript: and other dangerous schemes", () => {
		expect(safeUrl("javascript:alert(1)")).toBeNull();
		expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
		expect(safeUrl("file:///etc/passwd")).toBeNull();
		expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
	});

	it("rejects relative or unparseable values", () => {
		expect(safeUrl("#")).toBeNull();
		expect(safeUrl("/a/b/-/merge_requests/1")).toBeNull();
		expect(safeUrl("not a url")).toBeNull();
		expect(safeUrl("")).toBeNull();
		expect(safeUrl(null)).toBeNull();
		expect(safeUrl(undefined)).toBeNull();
	});
});

describe("project labels", () => {
	it("shortens to the project name", () => {
		expect(shortProject("org/group/monkey-island")).toBe("monkey-island");
		expect(shortProject("monkey-island")).toBe("monkey-island");
	});

	it("builds the chip reference label", () => {
		expect(refLabel("org/group/monkey-island", "231", false)).toBe("monkey-island/231");
		expect(refLabel("org/group/monkey-island", "231", true)).toBe(
			"org/group/monkey-island/231",
		);
	});
});
