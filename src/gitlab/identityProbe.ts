import { scopesAllowWrite, UNKNOWN_IDENTITY } from "../identity";
import type { Identity } from "../types";
import { fetchCurrentUsername, fetchTokenScopes, type ClientConfig } from "./client";

export interface IdentityProbe {
	identity: Identity;
	scopes: string[] | null;
}

/**
 * Ask GitLab who this token belongs to and whether it may write. Both halves fail softly:
 * a probe that cannot reach GitLab yields an unknown identity, and callers keep whatever
 * they had persisted rather than changing what the chips show.
 */
export async function probeIdentity(
	config: ClientConfig,
	now: number,
): Promise<IdentityProbe> {
	if (!config.token) {
		return { identity: { ...UNKNOWN_IDENTITY, checkedAt: now }, scopes: null };
	}

	const [username, scopes] = await Promise.all([
		fetchCurrentUsername(config).catch(() => null),
		fetchTokenScopes(config),
	]);

	return {
		identity: { username, canWrite: scopesAllowWrite(scopes), checkedAt: now },
		scopes,
	};
}
