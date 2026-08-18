import { debounce, MarkdownView, Plugin } from "obsidian";
import { MrStore } from "./cache";
import type { ClientConfig } from "./gitlab/client";
import { probeIdentity } from "./gitlab/identityProbe";
import { normalizeBaseUrl, normalizeGroupBase, type ParseContext } from "./parser";
import { createLivePreviewExtension } from "./render/livePreview";
import { MergeConfirmModal } from "./render/mergeModal";
import { createReadingProcessor } from "./render/reading";
import { DEFAULT_SETTINGS, type GitLabMrSettings } from "./settings";
import { GitLabMrSettingTab } from "./settingsTab";
import type { MrData } from "./types";

/** Obsidian's settings modal is not part of the public API. */
interface AppWithSettings {
	setting?: {
		open(): void;
		openTabById(id: string): void;
	};
}

export default class GitLabMrPlugin extends Plugin {
	settings: GitLabMrSettings = { ...DEFAULT_SETTINGS };
	store!: MrStore;

	/** Settings fire on every keystroke; only probe once typing settles. */
	private queueIdentityRefresh = debounce(() => void this.refreshIdentity(), 1200, true);

	/** Free-text settings fire per keystroke; coalesce the persist + rerender + refetch. */
	private queueApplySettings = debounce(() => void this.applySettings(), 600, false);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new MrStore(this);

		this.registerMarkdownPostProcessor(createReadingProcessor(this));
		this.registerEditorExtension(createLivePreviewExtension(this));
		this.addSettingTab(new GitLabMrSettingTab(this.app, this));

		this.addCommand({
			id: "refresh-merge-requests",
			name: "Refresh all merge requests",
			callback: () => this.store.refreshAll(),
		});
		this.addCommand({
			id: "open-settings",
			name: "Open settings",
			callback: () => this.openSettings(),
		});

		// Chips render immediately with the persisted identity; this refreshes it behind them.
		this.app.workspace.onLayoutReady(() => void this.refreshIdentity());
	}

	onunload(): void {
		this.store?.dispose();
	}

	get parseContext(): ParseContext {
		return {
			baseUrl: normalizeBaseUrl(this.settings.baseUrl),
			groupBase: normalizeGroupBase(this.settings.groupBase),
		};
	}

	clientConfig(): ClientConfig {
		return {
			baseUrl: normalizeBaseUrl(this.settings.baseUrl),
			token: this.settings.token.trim(),
		};
	}

	/** Never merges directly — the modal is the confirmation step. */
	requestMerge(data: MrData): void {
		new MergeConfirmModal(
			{
				app: this.app,
				clientConfig: () => this.clientConfig(),
				onMerged: () => this.store.refreshKey(`${data.fullPath}!${data.iid}`),
			},
			data,
		).open();
	}

	openSettings(): void {
		const app = this.app as unknown as AppWithSettings;
		app.setting?.open();
		app.setting?.openTabById(this.manifest.id);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * For text inputs: the caller updates settings in memory synchronously, and this commits
	 * the expensive persist + rerender + refetch once typing settles. Keeps a burst of
	 * keystrokes from clearing the cache and firing requests with a half-typed token.
	 */
	applySettingsSoon(): void {
		this.queueApplySettings();
	}

	/**
	 * Persist a change that affects what we fetch (base URL, group base, token): drop cached
	 * data that may now be wrong, re-render, and re-probe the identity.
	 */
	async applySettings(): Promise<void> {
		await this.saveData(this.settings);
		this.store.invalidateAll();
		this.rerender();
		this.queueIdentityRefresh();
	}

	/**
	 * Persist a cosmetic change (display toggles, title length, cache duration) and repaint
	 * open notes. The cached merge request data is still valid, so `repaint()` rebuilds each
	 * chip from it with the new settings without refetching; `rerender()` then handles the
	 * one toggle that adds or removes chips entirely (Render while editing).
	 */
	async applyDisplaySettings(): Promise<void> {
		await this.saveData(this.settings);
		this.store.repaint();
		this.rerender();
	}

	/**
	 * Re-probe who the token belongs to and whether it can merge. A failed probe leaves the
	 * persisted identity in place, so going offline never changes what chips show.
	 */
	async refreshIdentity(): Promise<string[] | null> {
		const { identity, scopes } = await probeIdentity(this.clientConfig(), Date.now());
		const previous = this.settings.identity;
		const resolved = identity.username !== null || !this.settings.token;

		if (resolved) {
			this.settings.identity = identity;
		} else {
			this.settings.identity = { ...previous, checkedAt: identity.checkedAt };
		}

		const changed =
			this.settings.identity.username !== previous.username ||
			this.settings.identity.canWrite !== previous.canWrite;

		if (changed) {
			await this.saveData(this.settings);
			this.store.repaint();
			this.rerender();
		}
		return scopes;
	}

	private rerender(): void {
		// Rebuilds editor extensions so Live Preview picks up the new parse context.
		this.app.workspace.updateOptions();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) view.previewMode?.rerender(true);
		}
	}
}
