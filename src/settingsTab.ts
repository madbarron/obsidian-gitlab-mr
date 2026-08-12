import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { errorMessage, fetchCurrentUsername } from "./gitlab/client";
import { describeScopes, scopesAllowWrite } from "./identity";
import { normalizeBaseUrl } from "./parser";
import type GitLabMrPlugin from "./main";

export class GitLabMrSettingTab extends PluginSettingTab {
	/** Survives the redraw that follows a connection test. */
	private lastTestResult: { ok: boolean; text: string } | null = null;

	constructor(
		app: App,
		private plugin: GitLabMrPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc(
				"Your GitLab instance. Only merge request links on this host are rendered.",
			)
			.addText((text) =>
				text
					.setPlaceholder("https://gitlab.com")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl)
			.setName("Group base")
			.setDesc(
				"Prefix for shorthand references. With 'org/group', !project/231 resolves to org/group/project!231. Leave empty to use full paths.",
			)
			.addText((text) =>
				text
					.setPlaceholder("org/group")
					.setValue(this.plugin.settings.groupBase)
					.onChange(async (value) => {
						this.plugin.settings.groupBase = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl)
			.setName("Personal access token")
			.setDesc(
				"`read_api` scope for rendering chips; `api` scope if you want the merge button. See instructions below.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				text
					.setPlaceholder("glpat-…")
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value;
						await this.plugin.applySettings();
					});
			});

		this.renderTokenInstructions(containerEl);
		this.renderConnectionTest(containerEl);

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("Render while editing")
			.setDesc(
				"Show chips in Live Preview. They turn back into plain text when the cursor enters them.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.renderInLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.renderInLivePreview = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl).setName("Show title").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showTitle)
				.onChange(async (value) => {
					this.plugin.settings.showTitle = value;
					await this.plugin.applySettings();
				}),
		);

		new Setting(containerEl)
			.setName("Maximum title length")
			.setDesc("Longer titles are truncated with an ellipsis.")
			.addSlider((slider) =>
				slider
					.setLimits(20, 140, 5)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.maxTitleLength)
					.onChange(async (value) => {
						this.plugin.settings.maxTitleLength = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show full project path")
			.setDesc("Off: project/231. On: org/group/project/231.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFullProjectPath)
					.onChange(async (value) => {
						this.plugin.settings.showFullProjectPath = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show pipeline status")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPipeline)
					.onChange(async (value) => {
						this.plugin.settings.showPipeline = value;
						await this.plugin.applySettings();
					}),
			);

		new Setting(containerEl).setName("Show reviewers").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showReviewers)
				.onChange(async (value) => {
					this.plugin.settings.showReviewers = value;
					await this.plugin.applySettings();
				}),
		);

		new Setting(containerEl)
			.setName("Show author initials")
			.setDesc(
				"Shown between the status and the reference, and only when the author is not you.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAuthor)
					.onChange(async (value) => {
						this.plugin.settings.showAuthor = value;
						await this.plugin.applySettings();
					}),
			);

		this.renderMergeSection(containerEl);

		new Setting(containerEl)
			.setName("Cache duration (minutes)")
			.setDesc(
				"How long merge request data is reused before refetching. Running pipelines always refresh every 30 seconds.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 60, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.cacheTtlMinutes)
					.onChange(async (value) => {
						this.plugin.settings.cacheTtlMinutes = value;
						await this.plugin.applySettings();
					}),
			);
	}

	private renderMergeSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Merging").setHeading();

		const { identity } = this.plugin.settings;
		new Setting(containerEl)
			.setName("Show merge button")
			.setDesc(
				identity.canWrite
					? "Shown only on your own merge requests that GitLab already considers mergeable. Clicking always asks for confirmation first."
					: "Your token cannot write, so the button stays hidden regardless of this setting. Use a token with the api scope to enable merging.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableMergeButton)
					.onChange(async (value) => {
						this.plugin.settings.enableMergeButton = value;
						await this.plugin.applySettings();
					}),
			);
	}

	private renderTokenInstructions(containerEl: HTMLElement): void {
		const baseUrl = normalizeBaseUrl(this.plugin.settings.baseUrl);
		const tokenUrl = `${baseUrl}/-/user_settings/personal_access_tokens?name=Obsidian+GitLab+MR&scopes=read_api`;

		const box = containerEl.createDiv({ cls: "gl-mr-settings-help" });
		box.createEl("p", { text: "Creating the token" });
		const steps = box.createEl("ol");

		const first = steps.createEl("li");
		first.appendText("Open ");
		first.createEl("a", { href: tokenUrl, text: tokenUrl });
		first.appendText(
			" (older self-hosted instances use /-/profile/personal_access_tokens instead).",
		);

		steps.createEl("li", {
			text: "Name it something like 'Obsidian GitLab MR' and set an expiry date (gitlab.com allows up to 365 days).",
		});
		steps.createEl("li", {
			text: "Scope: read_api renders everything. Choose api instead only if you want the merge button.",
		});
		steps.createEl("li", {
			text: "Create the token, copy it, and paste it in the field above.",
		});
		steps.createEl("li", {
			text: "Note: the token is stored in plain text in .obsidian/plugins/obsidian-gitlab-mr/data.json. Exclude that file from any sync you do not trust, and revoke the token from the same GitLab page if it ever leaks.",
		});
	}

	private renderConnectionTest(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verifies the base URL, the token and whether it can merge.")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Testing…");
						try {
							const username = await fetchCurrentUsername(
								this.plugin.clientConfig(),
							);
							const scopes = await this.plugin.refreshIdentity();
							const scopeNote = scopesAllowWrite(scopes)
								? "merge button enabled"
								: "merge button hidden: needs the 'api' scope";
							this.lastTestResult = {
								ok: true,
								text: `✓ connected as ${username}. Token scope: ${describeScopes(scopes)} (${scopeNote})`,
							};
							new Notice(`GitLab MR: connected as ${username}`);
						} catch (error) {
							const message = errorMessage(error);
							this.lastTestResult = { ok: false, text: `✕ ${message}` };
							new Notice(`GitLab MR: ${message}`);
						} finally {
							// Redrawing picks up the new identity in the merge section's description
							// and re-renders the result line below.
							this.display();
						}
					}),
			);

		if (this.lastTestResult) {
			const result = containerEl.createDiv({
				cls: `gl-mr-settings-result ${this.lastTestResult.ok ? "gl-mr-ok" : "gl-mr-bad"}`,
			});
			result.setText(this.lastTestResult.text);
		}
	}
}
