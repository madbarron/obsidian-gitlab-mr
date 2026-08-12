import type { Identity } from "./types";

/**
 * Pure identity helpers. Deliberately free of any `obsidian` import so they stay unit
 * testable — the network side lives in `gitlab/identityProbe.ts`.
 */

export const UNKNOWN_IDENTITY: Identity = {
	username: null,
	canWrite: false,
	checkedAt: 0,
};

/**
 * Only the standard `api` scope grants the write access the merge mutation needs.
 * `read_api`, granular-only tokens and anything we could not read (null) are read-only —
 * being conservative here is what keeps a dead merge button off the chip.
 */
export function scopesAllowWrite(scopes: string[] | null): boolean {
	if (!scopes) return false;
	return scopes.includes("api");
}

export function describeScopes(scopes: string[] | null): string {
	if (!scopes) return "unknown";
	if (scopes.length === 0) return "none";
	return scopes.join(", ");
}
