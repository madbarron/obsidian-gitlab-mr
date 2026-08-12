import { describe, expect, it } from "vitest";
import { describeScopes, scopesAllowWrite } from "../src/identity";
import { buildMergeInput } from "../src/gitlab/query";
import type { MrData } from "../src/types";

describe("scopesAllowWrite", () => {
	it("allows only the standard api scope", () => {
		expect(scopesAllowWrite(["api"])).toBe(true);
		expect(scopesAllowWrite(["read_user", "api"])).toBe(true);
	});

	it("treats read-only, empty and unreadable scopes as read-only", () => {
		expect(scopesAllowWrite(["read_api"])).toBe(false);
		expect(scopesAllowWrite(["read_api", "read_user"])).toBe(false);
		expect(scopesAllowWrite(["read_repository"])).toBe(false);
		expect(scopesAllowWrite([])).toBe(false);
		// null is "we could not determine the scopes" — must not enable merging.
		expect(scopesAllowWrite(null)).toBe(false);
	});

	it("does not mistake a scope that merely contains 'api'", () => {
		expect(scopesAllowWrite(["read_api_something"])).toBe(false);
		expect(scopesAllowWrite(["ai_features"])).toBe(false);
	});
});

describe("describeScopes", () => {
	it("describes what we know", () => {
		expect(describeScopes(["api", "read_user"])).toBe("api, read_user");
		expect(describeScopes([])).toBe("none");
		expect(describeScopes(null)).toBe("unknown");
	});
});

describe("buildMergeInput", () => {
	const data = {
		fullPath: "org/group/monkey-island",
		iid: "231",
		diffHeadSha: "abc123",
		squashDefault: false,
		squashLocked: false,
		removeSourceBranchDefault: false,
		removeSourceBranchLocked: false,
	} as MrData;

	it("sends the head sha so a moved branch is rejected by GitLab", () => {
		const input = buildMergeInput(data, { squash: true, removeSourceBranch: true });
		expect(input).toEqual({
			projectPath: "org/group/monkey-island",
			iid: "231",
			sha: "abc123",
			squash: true,
			shouldRemoveSourceBranch: true,
		});
	});

	it("passes the modal's choices through", () => {
		const input = buildMergeInput(data, { squash: false, removeSourceBranch: false });
		expect(input.squash).toBe(false);
		expect(input.shouldRemoveSourceBranch).toBe(false);
	});

	it("obeys project settings that lock the options", () => {
		const locked = { ...data, squashLocked: true, squashDefault: true } as MrData;
		expect(buildMergeInput(locked, { squash: false, removeSourceBranch: false }).squash).toBe(true);

		const forced = { ...data, removeSourceBranchLocked: true } as MrData;
		expect(
			buildMergeInput(forced, { squash: false, removeSourceBranch: false })
				.shouldRemoveSourceBranch,
		).toBe(true);
	});

	it("refuses to build input without a head sha", () => {
		const noSha = { ...data, diffHeadSha: null } as MrData;
		expect(() => buildMergeInput(noSha, { squash: false, removeSourceBranch: false })).toThrow(
			/head commit/i,
		);
	});
});
