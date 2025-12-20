import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type AutoGitPlugin from "./main";
import { t } from "./i18n";
import { isGitRepo, initRepo, getRemoteUrl, setRemoteUrl } from "./git";

export interface AutoGitSettings {
	autoCommit: boolean;
	debounceSeconds: number;
	commitTemplate: string;
	includeFileList: boolean;
	autoPush: boolean;
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

		containerEl.createEl("h2", { text: i18n.settingsTitle });

		// Repository section (async loading)
		if (!Platform.isMobileApp) {
			containerEl.createEl("h3", { text: i18n.sectionRepository });
			this.displayRepoSection(containerEl);
		}

		// Automation section
		containerEl.createEl("h3", { text: i18n.sectionAutomation });

		new Setting(containerEl)
			.setName(i18n.autoCommitName)
			.setDesc(i18n.autoCommitDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCommit).onChange(async (value) => {
					this.plugin.settings.autoCommit = value;
					await this.plugin.saveSettings();
					this.plugin.resetVaultListeners();
					this.display();
				})
			);

		if (this.plugin.settings.autoCommit) {
			new Setting(containerEl)
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

			new Setting(containerEl)
				.setName(i18n.autoPushName)
				.setDesc(i18n.autoPushDesc)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.autoPush).onChange(async (value) => {
						this.plugin.settings.autoPush = value;
						await this.plugin.saveSettings();
					})
				);
		}

		// Configuration section
		containerEl.createEl("h3", { text: i18n.sectionConfiguration });

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
					.setPlaceholder("git")
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

	private async displayRepoSection(containerEl: HTMLElement): Promise<void> {
		const i18n = t();
		const cwd = this.plugin.getVaultPathSafe();
		if (!cwd) return;

		const gitPath = this.plugin.settings.gitPath;
		const isRepo = await isGitRepo(cwd, gitPath);

		if (!isRepo) {
			new Setting(containerEl)
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
			new Setting(containerEl)
				.setName(i18n.repoStatusName)
				.setDesc(i18n.repoInitialized);

			const currentRemote = await getRemoteUrl(cwd, gitPath);
			let remoteInput = currentRemote;

			new Setting(containerEl)
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
		}
	}
}
