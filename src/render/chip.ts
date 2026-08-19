import {
	canOfferMerge,
	initials,
	pipelineDot,
	pipelineTooltip,
	refLabel,
	reviewView,
	safeUrl,
	shouldShowAuthor,
	statusView,
	truncate,
} from "../format";
import { mrWebUrl, normalizeBaseUrl } from "../parser";
import type { MrStore } from "../cache";
import type { GitLabMrSettings } from "../settings";
import type { MrData, MrEntry, MrError, MrRef } from "../types";

export interface ChipHost {
	settings: GitLabMrSettings;
	store: MrStore;
	openSettings(): void;
	/** Opens the merge confirmation modal. Wired in main.ts so this file stays DOM-only. */
	requestMerge(data: MrData): void;
}

const ERROR_VIEWS: Record<MrError["kind"], { glyph: string; label: string }> = {
	"no-token": { glyph: "⚙️", label: "set token" },
	unauthorized: { glyph: "🔒", label: "auth" },
	"not-found": { glyph: "⚠️", label: "not found" },
	"rate-limited": { glyph: "⏳", label: "rate limited" },
	server: { glyph: "⚠️", label: "gitlab error" },
	network: { glyph: "↻", label: "offline" },
	graphql: { glyph: "⚠️", label: "error" },
};

/**
 * One rendered merge request chip. Owns its subscription to the store and repaints
 * itself in place, which is what lets the same instance serve both the reading-mode
 * post-processor and the Live Preview widget.
 */
export class Chip {
	readonly el: HTMLElement;
	private unsubscribe: () => void;

	constructor(
		private host: ChipHost,
		private ref: MrRef,
	) {
		this.el = createSpan({ cls: "gl-mr-chip" });
		this.unsubscribe = host.store.subscribe(ref.key, () => this.paint());
		this.paint();
	}

	destroy(): void {
		this.unsubscribe();
	}

	private get fallbackUrl(): string {
		return mrWebUrl(this.ref, this.host.settings.baseUrl);
	}

	/** A safe external URL: the primary when it is http(s), else the constructed fallback. */
	private safeLink(primary: string | null | undefined): string {
		return safeUrl(primary) ?? safeUrl(this.fallbackUrl) ?? "#";
	}

	private paint(): void {
		const entry: MrEntry = this.host.store.get(this.ref);
		this.el.empty();
		this.el.className = "gl-mr-chip";

		if (entry.status === "loading") this.paintLoading();
		else if (entry.status === "error") this.paintError(entry.error);
		else this.paintData(entry.data);
	}

	private paintLoading(): void {
		this.el.addClass("gl-mr-loading");
		const main = this.el.createSpan({ cls: "gl-mr-main" });
		main.createSpan({ cls: "gl-mr-status gl-mr-skeleton", text: "···" });
		main.createSpan({
			cls: "gl-mr-ref",
			text: refLabel(this.ref.fullPath, this.ref.iid, this.host.settings.showFullProjectPath),
		});
	}

	private paintError(error: MrError): void {
		this.el.addClass("gl-mr-error", `gl-mr-error-${error.kind}`);
		const view = ERROR_VIEWS[error.kind] ?? ERROR_VIEWS.graphql;

		const main = this.el.createSpan({ cls: "gl-mr-main" });
		main.setAttribute("title", error.message);
		main.createSpan({ cls: "gl-mr-glyph", text: view.glyph });
		main.createSpan({ cls: "gl-mr-status", text: view.label });
		main.createSpan({
			cls: "gl-mr-ref",
			text: refLabel(this.ref.fullPath, this.ref.iid, this.host.settings.showFullProjectPath),
		});

		main.addEventListener("click", (event) => {
			event.preventDefault();
			if (error.kind === "no-token") this.host.openSettings();
			else this.host.store.refresh(this.ref);
		});
	}

	private paintData(data: MrData): void {
		const { settings } = this.host;
		const status = statusView(data.state, data.draft);
		this.el.addClass(`gl-mr-state-${status.modifier}`);

		const mainUrl = this.safeLink(data.webUrl);
		const main = this.el.createEl("a", { cls: "gl-mr-main", href: mainUrl });
		main.setAttribute(
			"title",
			`${data.fullPath}!${data.iid} — ${data.title}\n${status.label}\nShift+click to refresh`,
		);
		main.createSpan({ cls: "gl-mr-status", text: status.label });
		if (settings.showAuthor && data.author && shouldShowAuthor(data, settings.identity)) {
			const author = main.createSpan({
				cls: "gl-mr-author",
				text: initials(data.author.name, data.author.username),
			});
			author.setAttribute("title", `Author: ${data.author.name || data.author.username}`);
		}
		main.createSpan({
			cls: "gl-mr-ref",
			text: refLabel(data.fullPath, data.iid, settings.showFullProjectPath),
		});
		if (settings.showTitle) {
			main.createSpan({
				cls: "gl-mr-title",
				text: truncate(data.title, settings.maxTitleLength),
			});
		}
		if (data.unresolvedThreads > 0) {
			const threads = main.createSpan({
				cls: "gl-mr-threads",
				text: `(${data.unresolvedThreads})`,
			});
			threads.setAttribute(
				"title",
				`${data.unresolvedThreads} unresolved thread${data.unresolvedThreads === 1 ? "" : "s"}`,
			);
		}
		main.addEventListener("click", (event) => {
			event.preventDefault();
			if (event.shiftKey) this.host.store.refresh(this.ref);
			else this.openExternal(mainUrl);
		});

		if (settings.showPipeline && data.pipeline) {
			const view = pipelineDot(data.pipeline.status);
			const rawUrl = data.pipeline.detailsPath
				? `${normalizeBaseUrl(settings.baseUrl)}${data.pipeline.detailsPath}`
				: `${data.webUrl || this.fallbackUrl}/pipelines`;
			const url = this.safeLink(rawUrl);
			const tooltip = pipelineTooltip(data.pipeline);
			const pipeline = this.el.createEl("a", {
				cls: `gl-mr-pipeline gl-mr-pipe-${view.modifier}`,
				href: url,
			});
			pipeline.createSpan({ cls: `gl-mr-dot gl-mr-dot-${view.modifier}` });
			pipeline.setAttribute("title", tooltip);
			pipeline.setAttribute("aria-label", tooltip);
			pipeline.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openExternal(url);
			});
		}

		if (settings.showReviewers && data.reviewers.length > 0) {
			const reviewers = this.el.createSpan({ cls: "gl-mr-reviewers" });
			for (const reviewer of data.reviewers) {
				const view = reviewView(reviewer.reviewState);
				const who = reviewer.name || reviewer.username;
				const item = reviewers.createSpan({
					cls: `gl-mr-reviewer gl-mr-rev-${view.modifier}`,
				});
				item.setAttribute("title", `${who} — ${view.label}`);
				item.createSpan({ cls: "gl-mr-glyph", text: view.glyph });
				item.createSpan({
					cls: "gl-mr-initials",
					text: initials(reviewer.name, reviewer.username),
				});
			}
		}

		if (canOfferMerge(data, {
			enabled: settings.enableMergeButton,
			identity: settings.identity,
		})) {
			const button = this.el.createEl("button", { cls: "gl-mr-merge", text: "Merge" });
			button.setAttribute("title", `Merge into ${data.targetBranch}`);
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.host.requestMerge(data);
			});
		}
	}

	private openExternal(url: string): void {
		const safe = safeUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	}
}
