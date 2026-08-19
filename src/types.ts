/** Shared data shapes. Verified against the live gitlab.com GraphQL schema. */

/** `MergeRequestState` enum, minus the query-only `all`. */
export type MergeRequestState = "opened" | "closed" | "merged" | "locked";

/** `MergeRequestReviewState` enum (GitLab >= 17.0). */
export type ReviewState =
	| "UNREVIEWED"
	| "REVIEWED"
	| "REQUESTED_CHANGES"
	| "APPROVED"
	| "UNAPPROVED"
	| "REVIEW_STARTED";

/** `PipelineStatusEnum`. */
export type PipelineStatus =
	| "CREATED"
	| "WAITING_FOR_RESOURCE"
	| "WAITING_FOR_CALLBACK"
	| "PREPARING"
	| "PENDING"
	| "RUNNING"
	| "FAILED"
	| "SUCCESS"
	| "CANCELING"
	| "CANCELED"
	| "SKIPPED"
	| "MANUAL"
	| "SCHEDULED";

/**
 * `DetailedMergeStatus` enum. `MERGEABLE` is the only ready state; the rest name the
 * blocker. Treat unknown strings as "not mergeable" — GitLab adds values over time.
 */
export type DetailedMergeStatus =
	| "MERGEABLE"
	| "UNCHECKED"
	| "CHECKING"
	| "PREPARING"
	| "COMMITS_STATUS"
	| "CI_MUST_PASS"
	| "CI_STILL_RUNNING"
	| "DISCUSSIONS_NOT_RESOLVED"
	| "DRAFT_STATUS"
	| "NOT_OPEN"
	| "NOT_APPROVED"
	| "BLOCKED_STATUS"
	| "EXTERNAL_STATUS_CHECKS"
	| "JIRA_ASSOCIATION"
	| "CONFLICT"
	| "NEED_REBASE"
	| "APPROVALS_SYNCING"
	| "LOCKED_PATHS"
	| "LOCKED_LFS_FILES"
	| "MERGE_TIME"
	| "SECURITY_POLICIES_VIOLATIONS"
	| "SECURITY_POLICY_PIPELINE_CHECK"
	| "TITLE_NOT_MATCHING"
	| "REQUESTED_CHANGES";

/** A merge request reference found in note text. */
export interface MrRef {
	/** The exact text that was matched. */
	raw: string;
	/** Full project path, e.g. `org/group/project`. */
	fullPath: string;
	/** Merge request iid as a string (the GraphQL argument is `String!`). */
	iid: string;
	/** Cache key: `fullPath!iid`. */
	key: string;
	/** Offset of the match within the scanned text. */
	start: number;
	/** End offset (exclusive) of the match within the scanned text. */
	end: number;
}

export interface GitLabUser {
	username: string;
	name: string | null;
}

export interface Reviewer extends GitLabUser {
	reviewState: ReviewState | null;
	approved: boolean | null;
}

export interface PipelineInfo {
	status: PipelineStatus;
	active: boolean;
	failureReason: string | null;
	tooltip: string | null;
	label: string | null;
	detailsPath: string | null;
}

/** Everything the chip needs about one merge request. */
export interface MrData {
	fullPath: string;
	iid: string;
	title: string;
	state: MergeRequestState;
	draft: boolean;
	webUrl: string;
	unresolvedThreads: number;
	approved: boolean | null;
	approvalsRequired: number | null;
	approvalsLeft: number | null;
	author: GitLabUser | null;
	reviewers: Reviewer[];
	pipeline: PipelineInfo | null;
	/** GitLab's own merge gate; `MERGEABLE` means ready. */
	detailedMergeStatus: DetailedMergeStatus | string | null;
	/** Whether *you* are allowed to press merge on this MR. */
	canMerge: boolean;
	/** HEAD sha the merge mutation must be given, so a moved branch is rejected. */
	diffHeadSha: string | null;
	sourceBranch: string;
	targetBranch: string;
	squashDefault: boolean;
	squashLocked: boolean;
	removeSourceBranchDefault: boolean;
	removeSourceBranchLocked: boolean;
}

export type ErrorKind =
	| "no-token"
	| "unauthorized"
	| "not-found"
	| "rate-limited"
	| "server"
	| "network"
	| "graphql";

export interface MrError {
	kind: ErrorKind;
	message: string;
}

/** Who the configured token belongs to, and whether it may write. */
export interface Identity {
	username: string | null;
	/** True only when the token's scopes provably include `api`. */
	canWrite: boolean;
	checkedAt: number;
}

export type MrEntry =
	| { status: "loading" }
	| { status: "ok"; data: MrData; fetchedAt: number }
	| { status: "error"; error: MrError; fetchedAt: number };
