import { EventRef, Menu, Notice, Platform, Plugin, TAbstractFile, TFile, FileSystemAdapter } from "obsidian";
import { AutoGitSettings, AutoGitSettingTab, DEFAULT_SETTINGS } from "./settings";
import { getChangedFiles, commitAll, push, pull, getConflictFiles, markConflictsResolved, revertAll, revertFile, getChangedFilesSync, commitSyncAndPushDetached, setGitDebug } from "./git";
import { renderTemplate } from "./template";
import { t } from "./i18n";
import { RevertConfirmModal } from "./modals";
import { GitStatusBadgeManager } from "./statusBadges";

export default class AutoGitPlugin extends Plugin {
	settings: AutoGitSettings = DEFAULT_SETTINGS;

	private debounceTimer: number | null = null;
	private isCommitting = false;
	private pendingRerun = false;
	private vaultEventRefs: EventRef[] = [];
	private conflictFiles: Set<string> = new Set();
	private _hasConflicts = false;
	private resolveConflictCommand: { id: string } | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private beforeUnloadHandler: (() => void) | null = null;
	private statusBadges: GitStatusBadgeManager | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AutoGitSettingTab(this.app, this));
		this.updateRibbonButton();

		this.addCommand({
			id: "commit-now",
			name: "Commit now",
			callback: () => { void this.runCommit("manual"); },
		});

		this.addCommand({
			id: "commit-and-push",
			name: "Commit and push",
			callback: async () => {
				const committed = await this.runCommit("manual");
				if (committed) {
					await this.doPush();
				}
			},
		});

		this.addCommand({
			id: "pull-now",
			name: "Pull now",
			callback: () => { void this.doPull(); },
		});

		this.addCommand({
			id: "push-now",
			name: "Push now",
			callback: () => { void this.doPush(); },
		});

		this.setupVaultListeners();
		this.setupFileContextMenu();

		this.app.workspace.onLayoutReady(() => {
			this.initStatusBadges();

			if (this.settings.autoPullOnOpen && !Platform.isMobileApp) {
				void this.doPull();
			}
		});

		if (!Platform.isMobileApp) {
			this.beforeUnloadHandler = () => {
				if (this.settings.commitOnClose) {
					const cwd = this.getVaultPathSafe();
					if (cwd) {
						const changedFiles = getChangedFilesSync(cwd, this.settings.gitPath);
						if (changedFiles.length > 0) {
							const now = new Date();
							const subject = renderTemplate(this.settings.commitTemplate, {
								date: now.toISOString().slice(0, 10),
								time: now.toTimeString().slice(0, 8),
								files: changedFiles.slice(0, 5).join(", ") + (changedFiles.length > 5 ? "..." : ""),
								count: String(changedFiles.length),
							});
							let message = subject;
							if (this.settings.includeFileList) {
								const fileList = changedFiles.length <= 5
									? changedFiles.join("\n")
									: changedFiles.slice(0, 5).join("\n") + `\n... and ${changedFiles.length - 5} more`;
								message += "\n\n" + fileList;
							}
							commitSyncAndPushDetached(cwd, this.settings.gitPath, message);
						}
					}
				}
			};
			window.addEventListener("beforeunload", this.beforeUnloadHandler);
		}

		void this.checkConflicts();
	}

	onunload() {
		this.clearDebounce();
		this.removeVaultListeners();
		this.statusBadges?.stop();
		this.statusBadges = null;
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
		if (this.beforeUnloadHandler) {
			window.removeEventListener("beforeunload", this.beforeUnloadHandler);
			this.beforeUnloadHandler = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AutoGitSettings>);
		setGitDebug(this.settings.debugLog);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	resetVaultListeners() {
		this.clearDebounce();
		this.removeVaultListeners();
		this.setupVaultListeners();
	}

	private removeVaultListeners() {
		this.vaultEventRefs.forEach((ref) => this.app.vault.offref(ref));
		this.vaultEventRefs = [];
	}

	private setupVaultListeners() {
		if (Platform.isMobileApp) {
			new Notice(t().noticeMobileNotSupported);
			return;
		}

		this.vaultEventRefs.push(this.app.vault.on("create", (file) => this.onFileChange(file, "create")));
		this.vaultEventRefs.push(this.app.vault.on("modify", (file) => this.onFileChange(file, "modify")));
		this.vaultEventRefs.push(this.app.vault.on("delete", (file) => this.onFileChange(file, "delete")));
		this.vaultEventRefs.push(this.app.vault.on("rename", (file, oldPath) => this.onFileRename(file, oldPath)));
	}

	private onFileChange(file: TAbstractFile, type: "create" | "modify" | "delete") {
		if (!(file instanceof TFile)) return;
		if (this.shouldIgnore(file.path)) return;

		if (this.statusBadges) {
			if (type === "create") this.statusBadges.noteCreate(file.path);
			else if (type === "modify") this.statusBadges.noteModify(file.path);
			else if (type === "delete") this.statusBadges.noteDelete(file.path);
		}

		if (this.settings.autoCommit) this.scheduleCommit();
	}

	private onFileRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile)) return;
		if (this.shouldIgnore(oldPath) && this.shouldIgnore(file.path)) return;

		this.statusBadges?.noteRename(oldPath, file.path);

		if (this.settings.autoCommit) this.scheduleCommit();
	}

	private shouldIgnore(path: string): boolean {
		if (path.startsWith(".git/") || path.startsWith(".git\\")) return true;
		if (this.settings.ignoreObsidianDir) {
			const configDir = this.app.vault.configDir;
			if (path.startsWith(configDir + "/") || path.startsWith(configDir + "\\")) return true;
		}
		return false;
	}

	private scheduleCommit() {
		this.clearDebounce();
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			void this.runCommit("auto");
		}, this.settings.debounceSeconds * 1000);
	}

	private clearDebounce() {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private getVaultPath(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error(t().noticeDesktopOnly);
		}
		return adapter.getBasePath();
	}

	getVaultPathSafe(): string | null {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			return null;
		}
		return adapter.getBasePath();
	}

	async runCommit(reason: "manual" | "auto"): Promise<boolean> {
		if (this._hasConflicts) {
			if (reason === "manual") {
				new Notice(t().noticeCannotCommitConflict);
			}
			return false;
		}

		if (this.isCommitting) {
			this.pendingRerun = true;
			return false;
		}

		this.isCommitting = true;
		this.pendingRerun = false;
		let committed = false;

		try {
			const cwd = this.getVaultPath();
			const gitPath = this.settings.gitPath;

			const changedFiles = await getChangedFiles(cwd, gitPath);
			if (changedFiles.length === 0) {
				if (reason === "manual") {
					new Notice(t().noticeNoChanges);
				}
				return false;
			}

			const now = new Date();
			const subject = renderTemplate(this.settings.commitTemplate, {
				date: now.toISOString().slice(0, 10),
				time: now.toTimeString().slice(0, 8),
				files: changedFiles.slice(0, 5).join(", ") + (changedFiles.length > 5 ? "..." : ""),
				count: String(changedFiles.length),
			});

			let message = subject;
			if (this.settings.includeFileList) {
				const fileList = changedFiles.length <= 5
					? changedFiles.join("\n")
					: changedFiles.slice(0, 5).join("\n") + `\n... and ${changedFiles.length - 5} more`;
				message = subject + "\n\n" + fileList;
			}

			await commitAll(cwd, gitPath, message);
			committed = true;
			new Notice(t().noticeCommitted(changedFiles.length));

			if (this.settings.autoPush) {
				await this.doPush();
			}

			void this.statusBadges?.refresh();
		} catch (e) {
			new Notice(t().noticeAutoGitError((e as Error).message));
		} finally {
			this.isCommitting = false;
			if (this.pendingRerun) {
				this.scheduleCommit();
			}
		}

		return committed;
	}

	async doPush() {
		try {
			const cwd = this.getVaultPath();
			await push(cwd, this.settings.gitPath);
			new Notice(t().noticePushed);
		} catch (e) {
			new Notice(t().noticePushFailed((e as Error).message));
		}
	}

	updateRibbonButton() {
		if (this.settings.showRibbonButton && !Platform.isMobileApp) {
			if (!this.ribbonIconEl) {
				this.ribbonIconEl = this.addRibbonIcon("git-branch", "Git", (evt) => {
					this.showRibbonMenu(evt);
				});
			}
		} else if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	private showRibbonMenu(evt: MouseEvent) {
		const i18n = t();
		const menu = new Menu();

		menu.addItem((item) =>
			item.setTitle(i18n.ribbonMenuPull).setIcon("download").onClick(() => void this.doPull())
		);
		menu.addItem((item) =>
			item.setTitle(i18n.ribbonMenuCommit).setIcon("check").onClick(() => void this.runCommit("manual"))
		);
		menu.addItem((item) =>
			item.setTitle(i18n.ribbonMenuPush).setIcon("upload").onClick(() => void this.doPush())
		);
		menu.addItem((item) =>
			item.setTitle(i18n.ribbonMenuCommitAndPush).setIcon("upload").onClick(async () => {
				const committed = await this.runCommit("manual");
				if (committed) {
					await this.doPush();
				}
			})
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(i18n.ribbonMenuRevertAll).setIcon("rotate-ccw").onClick(() => void this.doRevert())
		);

		menu.showAtMouseEvent(evt);
	}

	private async doRevert() {
		try {
			const cwd = this.getVaultPath();
			const changedFiles = await getChangedFiles(cwd, this.settings.gitPath);

			if (changedFiles.length === 0) {
				new Notice(t().revertNoChanges);
				return;
			}

			new RevertConfirmModal(this.app, changedFiles, () => {
				void (async () => {
					try {
						await revertAll(cwd, this.settings.gitPath);
						new Notice(t().noticeReverted);
						void this.statusBadges?.refresh();
					} catch (e) {
						new Notice(t().noticeRevertFailed((e as Error).message));
					}
				})();
			}).open();
		} catch (e) {
			new Notice(t().noticeRevertFailed((e as Error).message));
		}
	}

	private setupFileContextMenu() {
		if (Platform.isMobileApp) return;

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;

				const filePath = file.path;
				const status = this.statusBadges?.getStatus(filePath);
				if (!status) return;

				menu.addItem((item) => {
					item.setTitle(t().revertFileMenu)
						.setIcon("rotate-ccw")
						.onClick(() => {
							new RevertConfirmModal(this.app, [filePath], () => {
								void (async () => {
									try {
										const cwd = this.getVaultPath();
										await revertFile(cwd, this.settings.gitPath, filePath);
										new Notice(t().noticeFileReverted);
										void this.statusBadges?.refresh();
									} catch (e) {
										new Notice(t().noticeFileRevertFailed((e as Error).message));
									}
								})();
							}).open();
						});
				});
			})
		);
	}

	async doPull() {
		if (Platform.isMobileApp) {
			new Notice(t().noticeMobileNotSupported);
			return;
		}

		try {
			const cwd = this.getVaultPath();
			const result = await pull(cwd, this.settings.gitPath);

			if (result.hasConflicts) {
				await this.checkConflicts();
				new Notice(t().noticeConflictDetected);
			} else if (result.success) {
				new Notice(t().noticePulled);
				void this.statusBadges?.refresh();
			}
		} catch (e) {
			new Notice(t().noticePullFailed((e as Error).message));
		}
	}

	private async checkConflicts() {
		const cwd = this.getVaultPathSafe();
		if (!cwd) return;

		const conflicts = await getConflictFiles(cwd, this.settings.gitPath);
		this.conflictFiles = new Set(conflicts);
		this.setHasConflicts(conflicts.length > 0);
		this.statusBadges?.setConflicts(this.conflictFiles);
	}

	setHasConflicts(value: boolean) {
		this._hasConflicts = value;

		if (value && !this.resolveConflictCommand) {
			this.resolveConflictCommand = this.addCommand({
				id: "resolve-conflicts",
				name: "Mark conflicts as resolved",
				callback: async () => {
					const cwd = this.getVaultPathSafe();
					if (!cwd) return;
					try {
						await markConflictsResolved(cwd, this.settings.gitPath);
						this.conflictFiles.clear();
						this.setHasConflicts(false);
						this.statusBadges?.setConflicts(this.conflictFiles);
						new Notice(t().noticeConflictResolved);
						void this.statusBadges?.refresh();
					} catch (e) {
						new Notice((e as Error).message);
					}
				},
			});
		}

		if (!value) {
			this.conflictFiles.clear();
			this.statusBadges?.setConflicts(this.conflictFiles);
		}
	}

	private initStatusBadges() {
		if (Platform.isMobileApp) return;

		this.statusBadges = new GitStatusBadgeManager({
			getCwd: () => this.getVaultPathSafe(),
			getGitPath: () => this.settings.gitPath,
			shouldIgnore: (path) => this.shouldIgnore(path),
		});

		this.statusBadges.setConflicts(this.conflictFiles);
		this.statusBadges.start(this.settings.showStatusBadge, this.settings.badgeRefreshInterval);
	}

	updateStatusBadges() {
		if (Platform.isMobileApp) {
			this.statusBadges?.stop();
			return;
		}

		if (!this.statusBadges) {
			this.initStatusBadges();
			return;
		}

		this.statusBadges.setConflicts(this.conflictFiles);
		this.statusBadges.start(this.settings.showStatusBadge, this.settings.badgeRefreshInterval);
	}

	refreshStatusBadges() {
		void this.statusBadges?.refresh();
	}
}
