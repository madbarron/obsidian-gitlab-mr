import { requestUrl } from "obsidian";
import type { ErrorKind, MrData, MrError, MrRef } from "../types";
import {
	buildBatchQuery,
	CURRENT_USER_QUERY,
	mapMrNode,
	MERGE_MUTATION,
	type BatchResponse,
	type MergeInput,
	type MergePayload,
} from "./query";

export interface ClientConfig {
	/** Normalized base URL, e.g. `https://gitlab.com`. */
	baseUrl: string;
	token: string;
}

export class GitLabApiError extends Error {
	constructor(
		readonly kind: ErrorKind,
		message: string,
	) {
		super(message);
		this.name = "GitLabApiError";
	}

	toMrError(): MrError {
		return { kind: this.kind, message: this.message };
	}
}

/**
 * GitLab's default complexity budget is easily blown by a wide alias fan-out, so keep
 * batches modest — a note with 30 links becomes 3 requests instead of 30.
 */
export const MAX_BATCH_SIZE = 10;

interface GraphQLEnvelope<T> {
	data?: T | null;
	errors?: Array<{ message: string }>;
}

export async function graphqlRequest<T>(
	config: ClientConfig,
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	if (!config.token) {
		throw new GitLabApiError("no-token", "No personal access token configured.");
	}

	let response;
	try {
		response = await requestUrl({
			url: `${config.baseUrl}/api/graphql`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.token}`,
			},
			body: JSON.stringify({ query, variables }),
			throw: false,
		});
	} catch (error) {
		throw new GitLabApiError(
			"network",
			`Could not reach ${config.baseUrl}: ${errorMessage(error)}`,
		);
	}

	if (response.status === 401 || response.status === 403) {
		throw new GitLabApiError(
			"unauthorized",
			`GitLab rejected the token (${response.status}). Check that it is valid and has the read_api scope.`,
		);
	}
	if (response.status === 404) {
		throw new GitLabApiError(
			"not-found",
			`No GraphQL endpoint at ${config.baseUrl}/api/graphql (404). Check the base URL.`,
		);
	}
	if (response.status >= 500) {
		throw new GitLabApiError("server", `GitLab returned ${response.status}.`);
	}

	let envelope: GraphQLEnvelope<T>;
	try {
		envelope = response.json as GraphQLEnvelope<T>;
	} catch {
		throw new GitLabApiError(
			"server",
			`Unexpected non-JSON response from GitLab (status ${response.status}).`,
		);
	}

	if (envelope?.errors?.length) {
		throw new GitLabApiError("graphql", envelope.errors.map((e) => e.message).join("; "));
	}
	if (!envelope?.data) {
		throw new GitLabApiError("graphql", "GitLab returned an empty response.");
	}
	return envelope.data;
}

export interface FetchResult {
	data?: MrData;
	error?: MrError;
}

/**
 * Fetch a batch of merge requests. A missing project or merge request is reported
 * per-reference rather than failing the whole batch, since one bad link in a note
 * should not blank out the others.
 */
export async function fetchMergeRequests(
	config: ClientConfig,
	refs: MrRef[],
): Promise<Map<string, FetchResult>> {
	const results = new Map<string, FetchResult>();
	if (refs.length === 0) return results;

	const { query, variables, aliases } = buildBatchQuery(refs);
	const data = await graphqlRequest<BatchResponse>(config, query, variables);
	const byKey = new Map(refs.map((ref) => [ref.key, ref]));

	for (const [alias, key] of aliases) {
		const ref = byKey.get(key);
		if (!ref) continue;

		const node = data[alias]?.mergeRequest ?? null;
		if (!node) {
			results.set(key, {
				error: {
					kind: "not-found",
					message: `${ref.fullPath}!${ref.iid} was not found, or your token cannot see it.`,
				},
			});
			continue;
		}
		results.set(key, { data: mapMrNode(ref.fullPath, node) });
	}

	return results;
}

export async function fetchCurrentUsername(config: ClientConfig): Promise<string> {
	const data = await graphqlRequest<{ currentUser: { username: string } | null }>(
		config,
		CURRENT_USER_QUERY,
	);
	if (!data.currentUser) {
		throw new GitLabApiError(
			"unauthorized",
			"The token authenticated but returned no user. Check its scopes.",
		);
	}
	return data.currentUser.username;
}

/**
 * Merge a merge request. Throws `GitLabApiError` for transport/auth problems and returns
 * GitLab's own `errors` array for refusals (stale sha, blocked merge, …) so the caller can
 * show them without guessing.
 */
export async function mergeMergeRequest(
	config: ClientConfig,
	input: MergeInput,
): Promise<string[]> {
	try {
		const data = await graphqlRequest<MergePayload>(config, MERGE_MUTATION, { input });
		return data.mergeRequestAccept?.errors ?? [];
	} catch (error) {
		if (error instanceof GitLabApiError && error.kind === "unauthorized") {
			throw new GitLabApiError(
				"unauthorized",
				"This token cannot merge. Merging needs a token with the full api scope (read_api is read-only).",
			);
		}
		throw error;
	}
}

/**
 * Read the scopes of the token being used. This is the plugin's only REST call — GraphQL
 * does not expose token scopes — and the docs note any token may call the self endpoint.
 * A null return means "could not determine", which callers treat as read-only.
 */
export async function fetchTokenScopes(config: ClientConfig): Promise<string[] | null> {
	if (!config.token) return null;
	try {
		const response = await requestUrl({
			url: `${config.baseUrl}/api/v4/personal_access_tokens/self`,
			method: "GET",
			headers: { Authorization: `Bearer ${config.token}` },
			throw: false,
		});
		if (response.status !== 200) return null;
		const body = response.json as { scopes?: unknown } | null;
		if (!body || !Array.isArray(body.scopes)) return null;
		return body.scopes.filter((scope): scope is string => typeof scope === "string");
	} catch {
		return null;
	}
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function toMrError(error: unknown): MrError {
	if (error instanceof GitLabApiError) return error.toMrError();
	return { kind: "network", message: errorMessage(error) };
}
