#!/usr/bin/env node
/**
 * Validate a token and the exact GraphQL query the plugin uses, outside of Obsidian.
 *
 *   node scripts/probe.mjs my-project 231
 *   node scripts/probe.mjs /org/group/my-project 231     (absolute path)
 *
 * Reads GITLAB_TOKEN, GITLAB_BASE_URL and GITLAB_GROUP_BASE from .env or the
 * environment. Prints the mapped chip data, so a wrong scope or path shows up here
 * rather than as a "not found" chip in a note.
 */
import process from "node:process";

try {
	process.loadEnvFile(".env");
} catch {
	/* environment only */
}

const baseUrl = (process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/+$/, "");
const groupBase = (process.env.GITLAB_GROUP_BASE || "").replace(/^\/+|\/+$/g, "");
const token = process.env.GITLAB_TOKEN;

const [rawPath, iid] = process.argv.slice(2);

if (!token) {
	console.error("Set GITLAB_TOKEN in .env or the environment (scope: read_api).");
	process.exit(1);
}
if (!rawPath || !iid) {
	console.error("Usage: node scripts/probe.mjs <project-or-path> <iid>");
	process.exit(1);
}

const absolute = rawPath.startsWith("/");
const cleanPath = rawPath.replace(/^\/+|\/+$/g, "");
const fullPath = absolute || !groupBase ? cleanPath : `${groupBase}/${cleanPath}`;

const query = `query Probe($p: ID!, $i: String!) {
  currentUser { username }
  project(fullPath: $p) {
    mergeRequest(iid: $i) {
      iid title state draft webUrl
      resolvableDiscussionsCount resolvedDiscussionsCount
      approved approvalsRequired approvalsLeft
      detailedMergeStatus diffHeadSha sourceBranch targetBranch
      squash squashOnMerge squashReadOnly shouldRemoveSourceBranch forceRemoveSourceBranch
      userPermissions { canMerge }
      author { username name }
      approvedBy { nodes { username name } }
      reviewers { nodes { username name mergeRequestInteraction { approved reviewed reviewState } } }
      headPipeline { status active failureReason detailedStatus { label tooltip detailsPath } }
    }
  }
}`;

const response = await fetch(`${baseUrl}/api/graphql`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
	},
	body: JSON.stringify({ query, variables: { p: fullPath, i: String(iid) } }),
});

console.log(`POST ${baseUrl}/api/graphql -> ${response.status}`);
const body = await response.json().catch(() => null);

if (!body) {
	console.error("Response was not JSON.");
	process.exit(1);
}
if (body.errors?.length) {
	console.error("GraphQL errors:", body.errors.map((e) => e.message).join("; "));
	process.exit(1);
}

console.log(`authenticated as: ${body.data?.currentUser?.username ?? "(unknown)"}`);

// Token scopes are not in GraphQL; the merge button depends on this answer.
const selfResponse = await fetch(`${baseUrl}/api/v4/personal_access_tokens/self`, {
	headers: { Authorization: `Bearer ${token}` },
}).catch(() => null);
const self = selfResponse?.ok ? await selfResponse.json().catch(() => null) : null;
const scopes = Array.isArray(self?.scopes) ? self.scopes : null;
console.log(
	`token scopes: ${scopes ? scopes.join(", ") : `unknown (status ${selfResponse?.status ?? "n/a"})`}` +
		` -> merge button ${scopes?.includes("api") ? "enabled" : "hidden"}`,
);

const mr = body.data?.project?.mergeRequest;
if (!mr) {
	console.error(`No merge request at ${fullPath}!${iid} (or the token cannot see it).`);
	process.exit(1);
}

const unresolved =
	(mr.resolvableDiscussionsCount ?? 0) - (mr.resolvedDiscussionsCount ?? 0);

console.log({
	fullPath,
	iid: mr.iid,
	state: mr.state,
	draft: mr.draft,
	title: mr.title,
	author: mr.author?.username ?? null,
	unresolvedThreads: Math.max(0, unresolved),
	merge: {
		detailedMergeStatus: mr.detailedMergeStatus,
		canMerge: mr.userPermissions?.canMerge ?? false,
		diffHeadSha: mr.diffHeadSha,
		branches: `${mr.sourceBranch} -> ${mr.targetBranch}`,
		squashDefault: Boolean(mr.squashOnMerge || mr.squash),
		squashLocked: Boolean(mr.squashReadOnly),
		removeSourceBranchDefault: Boolean(
			mr.forceRemoveSourceBranch || mr.shouldRemoveSourceBranch,
		),
	},
	pipeline: mr.headPipeline
		? {
				status: mr.headPipeline.status,
				active: mr.headPipeline.active,
				detailsPath: mr.headPipeline.detailedStatus?.detailsPath,
			}
		: null,
	reviewers: (mr.reviewers?.nodes ?? []).map((r) => ({
		username: r.username,
		reviewState: r.mergeRequestInteraction?.reviewState ?? null,
	})),
	approvedBy: (mr.approvedBy?.nodes ?? []).map((u) => u.username),
	approvals: { approved: mr.approved, required: mr.approvalsRequired, left: mr.approvalsLeft },
	webUrl: mr.webUrl,
});
