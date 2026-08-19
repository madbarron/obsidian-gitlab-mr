import { UNKNOWN_IDENTITY } from "./identity";
import type { Identity } from "./types";

export interface GitLabMrSettings {
	baseUrl: string;
	/** Prefix applied to shorthand references, e.g. `org/group`. */
	groupBase: string;
	token: string;
	cacheTtlMinutes: number;
	renderInLivePreview: boolean;
	showTitle: boolean;
	maxTitleLength: number;
	showFullProjectPath: boolean;
	showPipeline: boolean;
	showReviewers: boolean;
	showAuthor: boolean;
	enableMergeButton: boolean;
	/** Persisted result of the last successful identity probe; not user-editable. */
	identity: Identity;
}

export const DEFAULT_SETTINGS: GitLabMrSettings = {
	baseUrl: "https://gitlab.com",
	groupBase: "",
	token: "",
	cacheTtlMinutes: 5,
	renderInLivePreview: true,
	showTitle: true,
	maxTitleLength: 60,
	showFullProjectPath: false,
	showPipeline: true,
	showReviewers: true,
	showAuthor: true,
	// Off by default; the merge button setting stays disabled until a token with the api scope
	// is confirmed, at which point the user opts in.
	enableMergeButton: false,
	identity: UNKNOWN_IDENTITY,
};
