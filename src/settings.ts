import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type AutoGitPlugin from "./main";
import { t } from "./i18n";
import { isGitRepo, initRepo, getRemoteUrl, setRemoteUrl, hasConflicts, markConflictsResolved, pull } from "./git";

export interface AutoGitSettings {
	autoCommit: boolean;
	debounceSeconds: number;
	commitTemplate: string;
	includeFileList: boolean;
	autoPush: boolean;
	autoPullOnOpen: boolean;
	gitPath: string;
	ignoreObsidianDir: boolean;
	showStatusBadge: boolean;
}

export const DEFAULT_SETTINGS: AutoGitSettings = {
	autoCommit: false,
	debounceSeconds: 30,
	commitTemplate: "vault backup: {{date}} {{time}}",
	includeFileList: true,
	autoPush: false,
	autoPullOnOpen: false,
	gitPath: "git",
	ignoreObsidianDir: true,
	showStatusBadge: true,
};

export class AutoGitSettingTab extends PluginSettingTab {
	plugin: AutoGitPlugin;

	constructor(app: App, plugin: AutoGitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const i18n = t();
		containerEl.empty();

		new Setting(containerEl).setName(i18n.settingsTitle).setHeading();

		// Repository section
		if (!Platform.isMobileApp) {
			new Setting(containerEl).setName(i18n.sectionRepository).setHeading();
			const repoContainer = containerEl.createDiv();
			void this.displayRepoSection(repoContainer);
		}

		// Automation section
		new Setting(containerEl).setName(i18n.sectionAutomation).setHeading();

		new Setting(containerEl)
			.setName(i18n.autoPullOnOpenName)
			.setDesc(i18n.autoPullOnOpenDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoPullOnOpen).onChange(async (value) => {
					this.plugin.settings.autoPullOnOpen = value;
					await this.plugin.saveSettings();
				})
			);

		// Container for auto-commit related settings (created after toggle for correct order)
		let autoCommitSettings: HTMLDivElement;

		new Setting(containerEl)
			.setName(i18n.autoCommitName)
			.setDesc(i18n.autoCommitDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCommit).onChange(async (value) => {
					this.plugin.settings.autoCommit = value;
					await this.plugin.saveSettings();
					this.plugin.resetVaultListeners();
					autoCommitSettings.style.display = value ? "block" : "none";
				})
			);

		// Create container after toggle so it appears below
		autoCommitSettings = containerEl.createDiv();
		autoCommitSettings.style.display = this.plugin.settings.autoCommit ? "block" : "none";

		new Setting(autoCommitSettings)
			.setName(i18n.debounceName)
			.setDesc(i18n.debounceDesc)
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.debounceSeconds))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 5) {
							this.plugin.settings.debounceSeconds = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(autoCommitSettings)
			.setName(i18n.autoPushName)
			.setDesc(i18n.autoPushDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoPush).onChange(async (value) => {
					this.plugin.settings.autoPush = value;
					await this.plugin.saveSettings();
				})
			);

		// Configuration section
		new Setting(containerEl).setName(i18n.sectionConfiguration).setHeading();

		new Setting(containerEl)
			.setName(i18n.templateName)
			.setDesc(i18n.templateDesc)
			.addTextArea((text) =>
				text
					.setPlaceholder("vault backup: {{date}} {{time}}")
					.setValue(this.plugin.settings.commitTemplate)
					.onChange(async (value) => {
						this.plugin.settings.commitTemplate = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(i18n.includeFileListName)
			.setDesc(i18n.includeFileListDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.includeFileList).onChange(async (value) => {
					this.plugin.settings.includeFileList = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(i18n.showStatusBadgeName)
			.setDesc(i18n.showStatusBadgeDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showStatusBadge).onChange(async (value) => {
					this.plugin.settings.showStatusBadge = value;
					await this.plugin.saveSettings();
					this.plugin.refreshStatusBadges();
				})
			);

		new Setting(containerEl)
			.setName(i18n.gitPathName)
			.setDesc(i18n.gitPathDesc)
			.addText((text) =>
				text
					.setPlaceholder("Path to git executable")
					.setValue(this.plugin.settings.gitPath)
					.onChange(async (value) => {
						this.plugin.settings.gitPath = value.trim() || "git";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(i18n.ignoreObsidianName)
			.setDesc(i18n.ignoreObsidianDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.ignoreObsidianDir).onChange(async (value) => {
					this.plugin.settings.ignoreObsidianDir = value;
					await this.plugin.saveSettings();
				})
			);
	}

	private async displayRepoSection(container: HTMLElement): Promise<void> {
		const i18n = t();
		const cwd = this.plugin.getVaultPathSafe();
		if (!cwd) {
			container.empty();
			return;
		}

		const gitPath = this.plugin.settings.gitPath;
		const [isRepo, currentRemote, hasConflict] = await Promise.all([
			isGitRepo(cwd, gitPath),
			getRemoteUrl(cwd, gitPath),
			hasConflicts(cwd, gitPath),
		]);

		container.empty();

		if (!isRepo) {
			new Setting(container)
				.setName(i18n.repoStatusName)
				.setDesc(i18n.repoNotInitialized)
				.addButton((btn) =>
					btn.setButtonText(i18n.initRepoButton).onClick(async () => {
						try {
							await initRepo(cwd, gitPath);
							new Notice(i18n.noticeRepoInitialized);
							this.display();
						} catch (e) {
							new Notice((e as Error).message);
						}
					})
				);
		} else {
			new Setting(container)
				.setName(i18n.repoStatusName)
				.setDesc(i18n.repoInitialized);

			// Pull button
			new Setting(container)
				.setName(i18n.pullNowName)
				.setDesc(i18n.pullNowDesc)
				.addButton((btn) =>
					btn.setButtonText(i18n.pullNowButton).onClick(async () => {
						try {
							const result = await pull(cwd, gitPath);
							if (result.hasConflicts) {
								this.plugin.setHasConflicts(true);
								new Notice(i18n.noticeConflictDetected);
								this.display();
							} else {
								new Notice(i18n.noticePulled);
								this.plugin.refreshStatusBadges();
							}
						} catch (e) {
							new Notice(i18n.noticePullFailed((e as Error).message));
						}
					})
				);

			// Commit and push buttons
			new Setting(container)
				.setName(i18n.commitNowName)
				.setDesc(i18n.commitNowDesc)
				.addButton((btn) =>
					btn.setButtonText(i18n.commitNowButton).onClick(async () => {
						await this.plugin.runCommit("manual");
					})
				);

			new Setting(container)
				.setName(i18n.pushNowName)
				.setDesc(i18n.pushNowDesc)
				.addButton((btn) =>
					btn.setButtonText(i18n.pushNowButton).onClick(async () => {
						await this.plugin.doPush();
					})
				);

			let remoteInput = currentRemote;

			new Setting(container)
				.setName(i18n.remoteUrlName)
				.setDesc(i18n.remoteUrlDesc)
				.addText((text) =>
					text
						.setPlaceholder(i18n.remoteUrlPlaceholder)
						.setValue(currentRemote)
						.onChange((value) => {
							remoteInput = value.trim();
						})
				)
				.addButton((btn) =>
					btn.setButtonText(i18n.saveButton).onClick(async () => {
						if (!remoteInput) return;
						try {
							await setRemoteUrl(cwd, gitPath, remoteInput);
							new Notice(i18n.noticeRemoteSaved);
						} catch (e) {
							new Notice((e as Error).message);
						}
					})
				);

			// Show conflict resolution button only when there are conflicts
			if (hasConflict) {
				new Setting(container)
					.setName(i18n.conflictStatusName)
					.setDesc(i18n.conflictStatusDesc)
					.addButton((btn) =>
						btn
							.setButtonText(i18n.resolveConflictButton)
							.setWarning()
							.onClick(async () => {
								try {
									await markConflictsResolved(cwd, gitPath);
									this.plugin.setHasConflicts(false);
									new Notice(i18n.noticeConflictResolved);
									this.display();
								} catch (e) {
									new Notice((e as Error).message);
								}
							})
					);
			}
		}
	}
}
