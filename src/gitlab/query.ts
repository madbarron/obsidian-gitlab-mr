import type { MergeRequestState, MrData, MrRef, PipelineStatus, ReviewState } from "../types";

/**
 * Every field here was verified against the live gitlab.com GraphQL schema:
 * `project(fullPath: ID!)`, `mergeRequest(iid: String!)`, and on `MergeRequest`
 * `resolvableDiscussionsCount` / `resolvedDiscussionsCount` (unresolved threads =
 * the difference), `reviewers { mergeRequestInteraction { reviewState } }` and
 * `headPipeline { status detailedStatus { ... } }`.
 *
 * `approved` / `approvalsRequired` / `approvalsLeft` are tier-gated and may come back
 * null — every consumer treats them as optional.
 */
export const MR_FRAGMENT = `fragment MrChip on MergeRequest {
  iid
  title
  state
  draft
  webUrl
  resolvableDiscussionsCount
  resolvedDiscussionsCount
  approved
  approvalsRequired
  approvalsLeft
  detailedMergeStatus
  diffHeadSha
  sourceBranch
  targetBranch
  squash
  squashOnMerge
  squashReadOnly
  shouldRemoveSourceBranch
  forceRemoveSourceBranch
  userPermissions { canMerge }
  author { username name }
  approvedBy { nodes { username name } }
  reviewers {
    nodes {
      username
      name
      mergeRequestInteraction { approved reviewed reviewState }
    }
  }
  headPipeline {
    status
    active
    failureReason
    detailedStatus { label tooltip detailsPath }
  }
}`;

export const CURRENT_USER_QUERY = `query ObsidianGitLabMrPing { currentUser { username } }`;

/**
 * `sha` is required by GitLab and acts as an interlock: if anyone pushed to the source
 * branch since we read the merge request, the mutation is refused rather than merging
 * code we never showed the user.
 */
export const MERGE_MUTATION = `mutation ObsidianGitLabMerge($input: MergeRequestAcceptInput!) {
  mergeRequestAccept(input: $input) {
    errors
    mergeRequest { iid state webUrl }
  }
}`;

export interface MergeInput {
	projectPath: string;
	iid: string;
	sha: string;
	squash: boolean;
	shouldRemoveSourceBranch: boolean;
}

export interface MergePayload {
	mergeRequestAccept: {
		errors: string[];
		mergeRequest: { iid: string; state: string; webUrl: string } | null;
	} | null;
}

export interface MergeOptions {
	squash: boolean;
	removeSourceBranch: boolean;
}

/** Pure: turn chip data plus the modal's choices into mutation input. */
export function buildMergeInput(data: MrData, options: MergeOptions): MergeInput {
	if (!data.diffHeadSha) {
		throw new Error(
			"GitLab did not report a head commit for this merge request, so it cannot be merged safely from here.",
		);
	}
	return {
		projectPath: data.fullPath,
		iid: String(data.iid),
		sha: data.diffHeadSha,
		squash: data.squashLocked ? data.squashDefault : options.squash,
		shouldRemoveSourceBranch: data.removeSourceBranchLocked
			? true
			: options.removeSourceBranch,
	};
}

interface UserNode {
	username: string;
	name: string | null;
}

interface ReviewerNode extends UserNode {
	mergeRequestInteraction: {
		approved: boolean | null;
		reviewed: boolean | null;
		reviewState: ReviewState | null;
	} | null;
}

export interface MrNode {
	iid: string;
	title: string;
	state: MergeRequestState;
	draft: boolean;
	webUrl: string;
	resolvableDiscussionsCount: number | null;
	resolvedDiscussionsCount: number | null;
	approved: boolean | null;
	approvalsRequired: number | null;
	approvalsLeft: number | null;
	detailedMergeStatus: string | null;
	diffHeadSha: string | null;
	sourceBranch: string;
	targetBranch: string;
	squash: boolean;
	squashOnMerge: boolean;
	squashReadOnly: boolean;
	shouldRemoveSourceBranch: boolean | null;
	forceRemoveSourceBranch: boolean | null;
	userPermissions: { canMerge: boolean } | null;
	author: UserNode | null;
	approvedBy: { nodes: UserNode[] } | null;
	reviewers: { nodes: ReviewerNode[] } | null;
	headPipeline: {
		status: PipelineStatus;
		active: boolean;
		failureReason: string | null;
		detailedStatus: {
			label: string | null;
			tooltip: string | null;
			detailsPath: string | null;
		} | null;
	} | null;
}

export interface BatchResponse {
	[alias: string]: { mergeRequest: MrNode | null } | null;
}

export interface BuiltQuery {
	query: string;
	variables: Record<string, string>;
	/** Alias -> cache key, so responses can be matched back to their references. */
	aliases: Map<string, string>;
}

/** One request for many merge requests, using aliases and per-alias variables. */
export function buildBatchQuery(refs: MrRef[]): BuiltQuery {
	const variables: Record<string, string> = {};
	const aliases = new Map<string, string>();
	const declarations: string[] = [];
	const selections: string[] = [];

	refs.forEach((ref, index) => {
		const pathVar = `p${index}`;
		const iidVar = `i${index}`;
		const alias = `m${index}`;

		variables[pathVar] = ref.fullPath;
		variables[iidVar] = ref.iid;
		aliases.set(alias, ref.key);
		declarations.push(`$${pathVar}: ID!`, `$${iidVar}: String!`);
		selections.push(
			`  ${alias}: project(fullPath: $${pathVar}) { mergeRequest(iid: $${iidVar}) { ...MrChip } }`,
		);
	});

	const query = [
		`query ObsidianGitLabMrs(${declarations.join(", ")}) {`,
		...selections,
		"}",
		MR_FRAGMENT,
	].join("\n");

	return { query, variables, aliases };
}

export function mapMrNode(fullPath: string, node: MrNode): MrData {
	const resolvable = node.resolvableDiscussionsCount ?? 0;
	const resolved = node.resolvedDiscussionsCount ?? 0;

	const reviewers = (node.reviewers?.nodes ?? []).map((reviewer) => ({
		username: reviewer.username,
		name: reviewer.name,
		reviewState: reviewer.mergeRequestInteraction?.reviewState ?? null,
		approved: reviewer.mergeRequestInteraction?.approved ?? null,
	}));

	// People can approve without ever being a requested reviewer; the chip should
	// still show them, otherwise "approval status per reviewer" is incomplete.
	const seen = new Set(reviewers.map((r) => r.username));
	for (const approver of node.approvedBy?.nodes ?? []) {
		if (seen.has(approver.username)) continue;
		seen.add(approver.username);
		reviewers.push({
			username: approver.username,
			name: approver.name,
			reviewState: "APPROVED",
			approved: true,
		});
	}

	const pipeline = node.headPipeline
		? {
				status: node.headPipeline.status,
				active: node.headPipeline.active,
				failureReason: node.headPipeline.failureReason,
				tooltip: node.headPipeline.detailedStatus?.tooltip ?? null,
				label: node.headPipeline.detailedStatus?.label ?? null,
				detailsPath: node.headPipeline.detailedStatus?.detailsPath ?? null,
			}
		: null;

	return {
		fullPath,
		iid: String(node.iid),
		title: node.title,
		state: node.state,
		draft: Boolean(node.draft),
		webUrl: node.webUrl,
		unresolvedThreads: Math.max(0, resolvable - resolved),
		approved: node.approved,
		approvalsRequired: node.approvalsRequired,
		approvalsLeft: node.approvalsLeft,
		author: node.author
			? { username: node.author.username, name: node.author.name }
			: null,
		reviewers,
		pipeline,
		detailedMergeStatus: node.detailedMergeStatus,
		canMerge: Boolean(node.userPermissions?.canMerge),
		diffHeadSha: node.diffHeadSha,
		sourceBranch: node.sourceBranch,
		targetBranch: node.targetBranch,
		// `squashOnMerge` is what GitLab will actually do; `squash` is the MR's own flag.
		squashDefault: Boolean(node.squashOnMerge || node.squash),
		squashLocked: Boolean(node.squashReadOnly),
		removeSourceBranchDefault: Boolean(
			node.forceRemoveSourceBranch || node.shouldRemoveSourceBranch,
		),
		removeSourceBranchLocked: Boolean(node.forceRemoveSourceBranch),
	};
}
