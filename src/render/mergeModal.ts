import { App, Modal, Notice, Setting } from "obsidian";
import { errorMessage, mergeMergeRequest, type ClientConfig } from "../gitlab/client";
import { buildMergeInput } from "../gitlab/query";
import { shortProject } from "../format";
import type { MrData } from "../types";

export interface MergeModalDeps {
	app: App;
	clientConfig(): ClientConfig;
	/** Called after a successful merge so the chip repaints as Merged. */
	onMerged(): void;
}

/**
 * Confirmation step for a merge. Nothing is sent to GitLab until the user presses Merge
 * here, and GitLab's own `sha` interlock rejects the merge if the branch moved since the
 * chip was rendered.
 */
export class MergeConfirmModal extends Modal {
	private squash: boolean;
	private removeSourceBranch: boolean;
	private busy = false;
	private errorEl: HTMLElement | null = null;

	constructor(
		private deps: MergeModalDeps,
		private data: MrData,
	) {
		super(deps.app);
		this.squash = data.squashDefault;
		this.removeSourceBranch = data.removeSourceBranchDefault;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		const label = `${shortProject(this.data.fullPath)}!${this.data.iid}`;
		titleEl.setText(`Merge ${label}?`);

		contentEl.createEl("p", { cls: "gl-mr-modal-title", text: this.data.title });
		const branches = contentEl.createEl("p", { cls: "gl-mr-modal-branches" });
		branches.createSpan({ cls: "gl-mr-modal-branch", text: this.data.sourceBranch });
		branches.appendText(" → ");
		branches.createSpan({ cls: "gl-mr-modal-branch", text: this.data.targetBranch });

		new Setting(contentEl)
			.setName("Squash commits")
			.setDesc(
				this.data.squashLocked
					? "Fixed by this project's settings."
					: "Combine the branch's commits into one.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.squash)
					.setDisabled(this.data.squashLocked)
					.onChange((value) => {
						this.squash = value;
					}),
			);

		new Setting(contentEl)
			.setName("Delete source branch")
			.setDesc(
				this.data.removeSourceBranchLocked
					? "Required by this project's settings."
					: `Delete ${this.data.sourceBranch} after merging.`,
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.removeSourceBranch)
					.setDisabled(this.data.removeSourceBranchLocked)
					.onChange((value) => {
						this.removeSourceBranch = value;
					}),
			);

		this.errorEl = contentEl.createDiv({ cls: "gl-mr-modal-error" });
		this.errorEl.hide();

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					if (!this.busy) this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Merge")
					.setCta()
					.onClick(async () => {
						if (this.busy) return;
						this.busy = true;
						button.setDisabled(true).setButtonText("Merging…");
						try {
							await this.merge();
						} finally {
							this.busy = false;
							button.setDisabled(false).setButtonText("Merge");
						}
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async merge(): Promise<void> {
		const label = `${shortProject(this.data.fullPath)}!${this.data.iid}`;
		try {
			const input = buildMergeInput(this.data, {
				squash: this.squash,
				removeSourceBranch: this.removeSourceBranch,
			});
			const errors = await mergeMergeRequest(this.deps.clientConfig(), input);
			if (errors.length > 0) {
				this.showError(errors.join("; "));
				return;
			}
			new Notice(`GitLab MR: merged ${label}`);
			this.deps.onMerged();
			this.close();
		} catch (error) {
			this.showError(errorMessage(error));
		}
	}

	private showError(message: string): void {
		if (!this.errorEl) return;
		// GitLab refuses the merge when the branch moved under us; that is the interlock
		// working, and the fix is to look at what changed rather than to retry blindly.
		const stale = /sha|head of the source branch/i.test(message);
		this.errorEl.setText(
			stale
				? `${message} — the source branch changed since this chip was loaded. Close this, let the chip refresh, and check the new commits before merging.`
				: message,
		);
		this.errorEl.show();
	}
}
