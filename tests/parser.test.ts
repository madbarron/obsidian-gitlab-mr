import { describe, expect, it } from "vitest";
import {
	findMrRefs,
	mrWebUrl,
	normalizeBaseUrl,
	normalizeGroupBase,
	parseMrUrl,
	type ParseContext,
} from "../src/parser";

const ctx: ParseContext = { baseUrl: "https://gitlab.com", groupBase: "org/group" };

describe("normalizers", () => {
	it("strips trailing slashes and defaults the base URL", () => {
		expect(normalizeBaseUrl("https://gitlab.com/")).toBe("https://gitlab.com");
		expect(normalizeBaseUrl("  https://git.example.com//  ")).toBe("https://git.example.com");
		expect(normalizeBaseUrl("")).toBe("https://gitlab.com");
	});

	it("strips surrounding slashes from the group base", () => {
		expect(normalizeGroupBase("/org/group/")).toBe("org/group");
		expect(normalizeGroupBase("")).toBe("");
	});
});

describe("findMrRefs — URLs", () => {
	it("parses a plain merge request URL", () => {
		const text = "https://gitlab.com/org/group/monkey-island/-/merge_requests/231";
		const [ref] = findMrRefs(text, ctx);
		expect(ref.fullPath).toBe("org/group/monkey-island");
		expect(ref.iid).toBe("231");
		expect(ref.key).toBe("org/group/monkey-island!231");
		expect(text.slice(ref.start, ref.end)).toBe(text);
	});

	it("tolerates trailing paths, queries and anchors", () => {
		const refs = findMrRefs(
			[
				"https://gitlab.com/org/group/monkey-island/-/merge_requests/231/diffs",
				"https://gitlab.com/org/group/monkey-island/-/merge_requests/12#note_12345",
				"https://gitlab.com/org/group/monkey-island/-/merge_requests/7?commit_id=abc",
			].join("\n"),
			ctx,
		);
		expect(refs.map((r) => r.iid)).toEqual(["231", "12", "7"]);
		expect(refs.every((r) => r.fullPath === "org/group/monkey-island")).toBe(true);
	});

	it("keeps sentence punctuation out of the match", () => {
		const text = "See https://gitlab.com/org/group/monkey-island/-/merge_requests/231.";
		const [ref] = findMrRefs(text, ctx);
		expect(ref.raw.endsWith("231")).toBe(true);
		expect(ref.end).toBe(text.length - 1);
	});

	it("handles deeply nested groups", () => {
		const [ref] = findMrRefs(
			"https://gitlab.com/org/group/team/sub/proj/-/merge_requests/9",
			ctx,
		);
		expect(ref.fullPath).toBe("org/group/team/sub/proj");
	});

	it("ignores merge requests on another host", () => {
		expect(
			findMrRefs("https://gitlab.example.com/a/b/-/merge_requests/1", ctx),
		).toHaveLength(0);
	});

	it("ignores the target of a labeled markdown link", () => {
		expect(
			findMrRefs(
				"[the MR](https://gitlab.com/org/group/monkey-island/-/merge_requests/231)",
				ctx,
			),
		).toHaveLength(0);
	});

	it("ignores non-merge-request GitLab URLs", () => {
		expect(findMrRefs("https://gitlab.com/org/group/monkey-island/-/issues/231", ctx)).toHaveLength(
			0,
		);
	});
});

describe("findMrRefs — shorthand", () => {
	it("resolves a project against the group base", () => {
		const [ref] = findMrRefs("!monkey-island/231", ctx);
		expect(ref.fullPath).toBe("org/group/monkey-island");
		expect(ref.iid).toBe("231");
	});

	it("appends multi-segment shorthand to the group base", () => {
		const [ref] = findMrRefs("!other-team/proj/12", ctx);
		expect(ref.fullPath).toBe("org/group/other-team/proj");
		expect(ref.iid).toBe("12");
	});

	it("treats a leading slash as an absolute path", () => {
		const [ref] = findMrRefs("!/gitlab-org/gitlab/45", ctx);
		expect(ref.fullPath).toBe("gitlab-org/gitlab");
		expect(ref.iid).toBe("45");
	});

	it("uses the raw path when no group base is configured", () => {
		const [ref] = findMrRefs("!monkey-island/231", { ...ctx, groupBase: "" });
		expect(ref.fullPath).toBe("monkey-island");
	});

	it("does not fire mid-word or on embeds", () => {
		expect(findMrRefs("foo!bar/1", ctx)).toHaveLength(0);
		expect(findMrRefs("![alt](image/1.png)", ctx)).toHaveLength(0);
		expect(findMrRefs("![[some/note]]", ctx)).toHaveLength(0);
	});

	it("does not match plain fractions or versions", () => {
		expect(findMrRefs("10/20 done, v1.2/3 shipped", ctx)).toHaveLength(0);
	});

	it("requires the iid to be the whole final segment", () => {
		expect(findMrRefs("!monkey-island/12abc", ctx)).toHaveLength(0);
	});

	it("finds several references in one line, in order", () => {
		const refs = findMrRefs("Blocked by !monkey-island/231 and !scumm-bar/8 today", ctx);
		expect(refs.map((r) => r.key)).toEqual([
			"org/group/monkey-island!231",
			"org/group/scumm-bar!8",
		]);
		expect(refs[0].start).toBeLessThan(refs[1].start);
	});

	it("does not double-match a shorthand inside a URL", () => {
		const refs = findMrRefs(
			"https://gitlab.com/org/group/monkey-island/-/merge_requests/231",
			ctx,
		);
		expect(refs).toHaveLength(1);
	});
});

describe("parseMrUrl", () => {
	it("returns a reference for a matching URL", () => {
		const ref = parseMrUrl(
			"https://gitlab.com/org/group/monkey-island/-/merge_requests/231",
			ctx,
		);
		expect(ref?.key).toBe("org/group/monkey-island!231");
	});

	it("rejects URLs that are not merge requests or not on the instance", () => {
		expect(parseMrUrl("https://gitlab.com/org/group/x/-/issues/1", ctx)).toBeNull();
		expect(parseMrUrl("https://example.com/a/b/-/merge_requests/1", ctx)).toBeNull();
		expect(parseMrUrl("not a url", ctx)).toBeNull();
	});
});

describe("mrWebUrl", () => {
	it("builds a fallback URL before data arrives", () => {
		const [ref] = findMrRefs("!monkey-island/231", ctx);
		expect(mrWebUrl(ref, "https://gitlab.com/")).toBe(
			"https://gitlab.com/org/group/monkey-island/-/merge_requests/231",
		);
	});
});
