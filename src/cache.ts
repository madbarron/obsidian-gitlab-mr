import { fetchMergeRequests, MAX_BATCH_SIZE, toMrError, type ClientConfig } from "./gitlab/client";
import type { MrEntry, MrRef } from "./types";

/** Running/pending pipelines change fast, so they get their own short TTL. */
const ACTIVE_PIPELINE_TTL_MS = 30_000;
/** Errors are retried sooner than successes so coming back online recovers on its own. */
const ERROR_TTL_MS = 30_000;
/** How long to gather references before firing a request. */
const BATCH_WINDOW_MS = 30;

const LOADING: MrEntry = { status: "loading" };

export interface StoreHost {
	settings: { cacheTtlMinutes: number };
	clientConfig(): ClientConfig;
}

/**
 * Holds merge request state for every reference on screen. Renderers call `get()`
 * synchronously and `subscribe()` for updates; fetching, batching, de-duplication and
 * staleness all happen in here.
 */
export class MrStore {
	private entries = new Map<string, MrEntry>();
	private knownRefs = new Map<string, MrRef>();
	private pending = new Set<string>();
	private queue = new Map<string, MrRef>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Map<string, Set<() => void>>();

	constructor(private host: StoreHost) {}

	/** Current state for a reference, scheduling a fetch when missing or stale. */
	get(ref: MrRef): MrEntry {
		this.knownRefs.set(ref.key, ref);
		const entry = this.entries.get(ref.key);
		if (!this.pending.has(ref.key) && (!entry || this.isStale(entry))) {
			this.enqueue(ref);
		}
		// Stale data is returned as-is while the refresh runs, so chips never flicker.
		return entry ?? LOADING;
	}

	subscribe(key: string, listener: () => void): () => void {
		const set = this.listeners.get(key) ?? new Set<() => void>();
		set.add(listener);
		this.listeners.set(key, set);
		return () => {
			const current = this.listeners.get(key);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) this.listeners.delete(key);
		};
	}

	/** Force a refetch of one reference (Shift+click on a chip). */
	refresh(ref: MrRef): void {
		this.enqueue(ref);
		this.notify(ref.key);
	}

	/** Force a refetch by cache key, for callers that only hold merge request data. */
	refreshKey(key: string): void {
		const ref = this.knownRefs.get(key);
		if (ref) this.refresh(ref);
	}

	/** Force a refetch of everything seen so far, keeping current data visible. */
	refreshAll(): void {
		for (const ref of this.knownRefs.values()) this.enqueue(ref);
		this.notifyAll();
	}

	/** Repaint every chip without refetching — used when identity resolves. */
	repaint(): void {
		this.notifyAll();
	}

	/** Drop all state — used when settings change and cached data may be wrong. */
	invalidateAll(): void {
		this.entries.clear();
		this.queue.clear();
		this.pending.clear();
		this.knownRefs.clear();
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.notifyAll();
	}

	dispose(): void {
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
		this.flushTimer = null;
		this.listeners.clear();
	}

	private isStale(entry: MrEntry): boolean {
		if (entry.status === "loading") return false;
		const age = Date.now() - entry.fetchedAt;
		if (entry.status === "error") {
			// A missing token or a bad link will not fix itself; wait for a settings change.
			if (entry.error.kind === "no-token") return false;
			return age >= ERROR_TTL_MS;
		}
		const ttl = entry.data.pipeline?.active
			? ACTIVE_PIPELINE_TTL_MS
			: Math.max(30_000, this.host.settings.cacheTtlMinutes * 60_000);
		return age >= ttl;
	}

	private enqueue(ref: MrRef): void {
		if (this.pending.has(ref.key)) return;
		this.pending.add(ref.key);
		this.queue.set(ref.key, ref);
		if (this.flushTimer === null) {
			this.flushTimer = setTimeout(() => void this.flush(), BATCH_WINDOW_MS);
		}
	}

	private async flush(): Promise<void> {
		this.flushTimer = null;
		const refs = [...this.queue.values()];
		this.queue.clear();
		if (refs.length === 0) return;

		const config = this.host.clientConfig();
		if (!config.token) {
			const error = {
				kind: "no-token" as const,
				message: "Add a GitLab personal access token in the GitLab MR settings.",
			};
			for (const ref of refs) {
				this.settle(ref.key, { status: "error", error, fetchedAt: Date.now() });
			}
			return;
		}

		for (let index = 0; index < refs.length; index += MAX_BATCH_SIZE) {
			const chunk = refs.slice(index, index + MAX_BATCH_SIZE);
			try {
				const results = await fetchMergeRequests(config, chunk);
				const fetchedAt = Date.now();
				for (const ref of chunk) {
					const result = results.get(ref.key);
					if (result?.data) {
						this.settle(ref.key, { status: "ok", data: result.data, fetchedAt });
					} else {
						this.settle(ref.key, {
							status: "error",
							error: result?.error ?? {
								kind: "graphql",
								message: "GitLab returned no data for this merge request.",
							},
							fetchedAt,
						});
					}
				}
			} catch (error) {
				const mrError = toMrError(error);
				const fetchedAt = Date.now();
				for (const ref of chunk) {
					this.settle(ref.key, { status: "error", error: mrError, fetchedAt });
				}
			}
		}
	}

	private settle(key: string, entry: MrEntry): void {
		this.entries.set(key, entry);
		this.pending.delete(key);
		this.notify(key);
	}

	private notify(key: string): void {
		for (const listener of this.listeners.get(key) ?? []) listener();
	}

	private notifyAll(): void {
		for (const set of this.listeners.values()) {
			for (const listener of set) listener();
		}
	}
}
