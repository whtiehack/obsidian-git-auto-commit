import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type AutoGitPlugin from "./main";
import { t } from "./i18n";
import { isGitRepo, initRepo, getRemoteUrl, setRemoteUrl, hasConflicts, markConflictsResolved, pull, detectRepoState, RepoState, connectToRemote, initAndPush, setUpstream } from "./git";

export interface AutoGitSettings {
	autoCommit: boolean;
	debounceSeconds: number;
	commitTemplate: string;
	includeFileList: boolean;
	autoPush: boolean;
	autoPullOnOpen: boolean;
	commitOnClose: boolean;
	gitPath: string;
	ignoreObsidianDir: boolean;
	showStatusBadge: boolean;
	showRibbonButton: boolean;
}

export const DEFAULT_SETTINGS: AutoGitSettings = {
	autoCommit: false,
	debounceSeconds: 30,
	commitTemplate: "vault backup: {{date}} {{time}}",
	includeFileList: true,
	autoPush: false,
	autoPullOnOpen: false,
	commitOnClose: false,
	gitPath: "git",
	ignoreObsidianDir: true,
	showStatusBadge: true,
	showRibbonButton: true,
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

		// Setup wizard section (for new users)
		if (!Platform.isMobileApp) {
			const setupContainer = containerEl.createDiv();
			void this.displaySetupSection(setupContainer);
		}

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

		new Setting(containerEl)
			.setName(i18n.commitOnCloseName)
			.setDesc(i18n.commitOnCloseDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.commitOnClose).onChange(async (value) => {
					this.plugin.settings.commitOnClose = value;
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
			.setName(i18n.showRibbonButtonName)
			.setDesc(i18n.showRibbonButtonDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRibbonButton).onChange(async (value) => {
					this.plugin.settings.showRibbonButton = value;
					await this.plugin.saveSettings();
					this.plugin.updateRibbonButton();
				})
			);

		new Setting(containerEl)
			.setName(i18n.gitPathName)
			.setDesc(i18n.gitPathDesc)
			.addText((text) =>
				text
					.setPlaceholder(i18n.gitPathPlaceholder)
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

	private async displaySetupSection(container: HTMLElement): Promise<void> {
		const i18n = t();
		const cwd = this.plugin.getVaultPathSafe();
		if (!cwd) {
			container.empty();
			return;
		}

		const gitPath = this.plugin.settings.gitPath;
		const state = await detectRepoState(cwd, gitPath);

		container.empty();

		// Only show setup section if not ready
		if (state === "ready") {
			return;
		}

		new Setting(container).setName(i18n.sectionSetup).setHeading();

		// Show current state
		const stateLabels: Record<RepoState, string> = {
			"not-a-repo": i18n.setupNotRepo,
			"empty-repo": i18n.setupEmptyRepo,
			"local-only": i18n.setupLocalOnly,
			"remote-no-upstream": i18n.setupNoUpstream,
			"ready": i18n.setupReady,
		};

		new Setting(container)
			.setName(i18n.repoStatusName)
			.setDesc(stateLabels[state]);

		let remoteInput = "";

		if (state === "not-a-repo" || state === "empty-repo") {
			// Option 1: Connect to existing remote
			new Setting(container)
				.setName(i18n.wizardConnectRemote)
				.setDesc(i18n.wizardConnectRemoteDesc)
				.addText((text) =>
					text
						.setPlaceholder(i18n.remoteUrlPlaceholder)
						.onChange((value) => {
							remoteInput = value.trim();
						})
				)
				.addButton((btn) =>
					btn.setButtonText(i18n.wizardConnectButton).onClick(async () => {
						if (!remoteInput) return;
						try {
							const ignoreDir = this.plugin.settings.ignoreObsidianDir ? this.app.vault.configDir : undefined;
							await connectToRemote(cwd, gitPath, remoteInput, ignoreDir);
							new Notice(i18n.noticeConnected);
							this.display();
							this.plugin.refreshStatusBadges();
						} catch (e) {
							new Notice(i18n.noticeConnectFailed((e as Error).message));
						}
					})
				);

			// Option 2: Create new repo and push to empty remote
			new Setting(container)
				.setName(i18n.wizardInitAndPush)
				.setDesc(i18n.wizardInitAndPushDesc)
				.addText((text) =>
					text
						.setPlaceholder(i18n.remoteUrlPlaceholder)
						.onChange((value) => {
							remoteInput = value.trim();
						})
				)
				.addButton((btn) =>
					btn.setButtonText(i18n.wizardInitAndPushButton).onClick(async () => {
						if (!remoteInput) return;
						try {
							const ignoreDir = this.plugin.settings.ignoreObsidianDir ? this.app.vault.configDir : undefined;
							await initAndPush(cwd, gitPath, remoteInput, "main", ignoreDir);
							new Notice(i18n.noticeInitPushSuccess);
							this.display();
							this.plugin.refreshStatusBadges();
						} catch (e) {
							new Notice(i18n.noticeInitPushFailed((e as Error).message));
						}
					})
				);

			// Option 3: Local only
			new Setting(container)
				.setName(i18n.wizardLocalOnly)
				.setDesc(i18n.wizardLocalOnlyDesc)
				.addButton((btn) =>
					btn.setButtonText(i18n.wizardLocalOnlyButton).onClick(async () => {
						try {
							await initRepo(cwd, gitPath);
							new Notice(i18n.noticeRepoInitialized);
							this.display();
						} catch (e) {
							new Notice((e as Error).message);
						}
					})
				);
		} else if (state === "local-only") {
			// Has commits but no remote - offer to add remote
			new Setting(container)
				.setName(i18n.wizardInitAndPush)
				.setDesc(i18n.wizardInitAndPushDesc)
				.addText((text) =>
					text
						.setPlaceholder(i18n.remoteUrlPlaceholder)
						.onChange((value) => {
							remoteInput = value.trim();
						})
				)
				.addButton((btn) =>
					btn.setButtonText(i18n.wizardSetUpstreamButton).onClick(async () => {
						if (!remoteInput) return;
						try {
							await setRemoteUrl(cwd, gitPath, remoteInput);
							await setUpstream(cwd, gitPath);
							new Notice(i18n.noticeUpstreamSet);
							this.display();
						} catch (e) {
							new Notice(i18n.noticeUpstreamFailed((e as Error).message));
						}
					})
				);
		} else if (state === "remote-no-upstream") {
			// Has remote but no upstream - offer to set upstream
			new Setting(container)
				.setName(i18n.wizardSetUpstream)
				.setDesc(i18n.wizardSetUpstreamDesc)
				.addButton((btn) =>
					btn.setButtonText(i18n.wizardSetUpstreamButton).onClick(async () => {
						try {
							await setUpstream(cwd, gitPath);
							new Notice(i18n.noticeUpstreamSet);
							this.display();
						} catch (e) {
							new Notice(i18n.noticeUpstreamFailed((e as Error).message));
						}
					})
				);
		}
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
