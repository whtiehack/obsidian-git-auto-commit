import { EventRef, Menu, Notice, Platform, Plugin, TAbstractFile, TFile, FileSystemAdapter } from "obsidian";
import { AutoGitSettings, AutoGitSettingTab, DEFAULT_SETTINGS } from "./settings";
import { getChangedFiles, commitAll, push, pull, getFileStatuses, getConflictFiles, markConflictsResolved, revertAll, revertFile, FileStatus, getChangedFilesSync, commitSyncAndPushDetached } from "./git";
import { renderTemplate } from "./template";
import { t } from "./i18n";
import { RevertConfirmModal } from "./modals";

export default class AutoGitPlugin extends Plugin {
	settings: AutoGitSettings = DEFAULT_SETTINGS;

	private debounceTimer: number | null = null;
	private isCommitting = false;
	private pendingRerun = false;
	private vaultEventRefs: EventRef[] = [];
	private statusRefreshInterval: number | null = null;
	private statusRefreshTimeout: number | null = null;
	private currentStatuses: Map<string, FileStatus> = new Map();
	private previousStatuses: Map<string, FileStatus> = new Map();
	private conflictFiles: Set<string> = new Set();
	private _hasConflicts = false;
	private resolveConflictCommand: { id: string } | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private beforeUnloadHandler: (() => void) | null = null;
	private mutationObserver: MutationObserver | null = null;

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

		// Wait for layout ready before initializing
		this.app.workspace.onLayoutReady(() => {
			this.updateStatusBadges();

			if (this.settings.autoPullOnOpen && !Platform.isMobileApp) {
				void this.doPull();
			}
		});

		// Setup beforeunload handler for commit on close
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
								message += "\n\n" + changedFiles.join("\n");
							}
							// Sync commit + detached push (push runs in background after app closes)
							commitSyncAndPushDetached(cwd, this.settings.gitPath, message);
						}
					}
				}
			};
			window.addEventListener("beforeunload", this.beforeUnloadHandler);
		}

		// Check for existing conflicts on load
		void this.checkConflicts();
	}

	onunload() {
		this.clearDebounce();
		this.removeVaultListeners();
		this.clearStatusBadges();
		if (this.statusRefreshInterval) {
			window.clearInterval(this.statusRefreshInterval);
			this.statusRefreshInterval = null;
		}
		if (this.statusRefreshTimeout) {
			window.clearTimeout(this.statusRefreshTimeout);
			this.statusRefreshTimeout = null;
		}
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}
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

		const handler = (file: TAbstractFile) => this.onFileChange(file);

		this.vaultEventRefs.push(this.app.vault.on("create", handler));
		this.vaultEventRefs.push(this.app.vault.on("modify", handler));
		this.vaultEventRefs.push(this.app.vault.on("delete", handler));
		this.vaultEventRefs.push(this.app.vault.on("rename", handler as (file: TAbstractFile, oldPath: string) => void));
	}

	private onFileChange(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;
		if (this.shouldIgnore(file.path)) return;

		// Always refresh badges on file change
		this.scheduleStatusRefresh();

		// Only schedule commit if autoCommit is enabled
		if (this.settings.autoCommit) {
			this.scheduleCommit();
		}
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
		// Don't commit if there are conflicts
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
				message = subject + "\n\n" + changedFiles.join("\n");
			}

			await commitAll(cwd, gitPath, message);
			committed = true;
			new Notice(t().noticeCommitted(changedFiles.length));

			if (this.settings.autoPush) {
				await this.doPush();
			}

			// Refresh badges after commit
			this.refreshStatusBadges();
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
						this.refreshStatusBadges();
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
				const status = this.currentStatuses.get(filePath);
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
										this.refreshStatusBadges();
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
				this.refreshStatusBadges();
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
		this.refreshStatusBadges();
	}

	setHasConflicts(value: boolean) {
		this._hasConflicts = value;

		if (value && !this.resolveConflictCommand) {
			// Add resolve conflict command when conflicts exist
			// Note: Obsidian doesn't support removing commands, so we keep the reference
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
						new Notice(t().noticeConflictResolved);
						this.refreshStatusBadges();
					} catch (e) {
						new Notice((e as Error).message);
					}
				},
			});
		}

		if (!value) {
			this.conflictFiles.clear();
		}
	}

	// Status badge functionality
	updateStatusBadges() {
		// Clear existing timers
		if (this.statusRefreshInterval) {
			window.clearInterval(this.statusRefreshInterval);
			this.statusRefreshInterval = null;
		}
		if (this.statusRefreshTimeout) {
			window.clearTimeout(this.statusRefreshTimeout);
			this.statusRefreshTimeout = null;
		}
		// Disconnect existing observer
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}

		if (Platform.isMobileApp || !this.settings.showStatusBadge) {
			this.clearStatusBadges();
			return;
		}

		// Initial refresh
		this.refreshStatusBadges();

		// Setup polling if interval > 0
		const interval = this.settings.badgeRefreshInterval;
		if (interval > 0) {
			this.statusRefreshInterval = window.setInterval(() => {
				this.refreshStatusBadges();
			}, interval * 1000);
		}

		// Setup MutationObserver for virtualized file list
		this.setupMutationObserver();
	}

	private setupMutationObserver() {
		// Find file explorer container
		const container = document.querySelector(".nav-files-container");
		if (!container) return;

		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				mutation.addedNodes.forEach((node) => {
					if (node instanceof HTMLElement) {
						this.applyBadgesToNewNodes(node);
					}
				});
			}
		});

		this.mutationObserver.observe(container, {
			childList: true,
			subtree: true,
		});
	}

	private applyBadgesToNewNodes(node: HTMLElement) {
		// Check if node itself is a file/folder title
		const items = node.matches(".nav-file-title, .nav-folder-title")
			? [node]
			: Array.from(node.querySelectorAll(".nav-file-title, .nav-folder-title"));

		const allStatuses = this.getMergedStatuses();

		for (const item of items) {
			const path = item.getAttribute("data-path");
			if (!path) continue;

			// Skip if already has badge
			if (item.querySelector(".git-status-badge")) continue;

			const status = allStatuses.get(path);
			if (status) {
				this.addBadgeToElement(item, status);
			}
		}
	}

	private scheduleStatusRefresh() {
		if (!this.settings.showStatusBadge) return;
		// Debounced refresh after file change
		if (this.statusRefreshTimeout) {
			window.clearTimeout(this.statusRefreshTimeout);
		}
		this.statusRefreshTimeout = window.setTimeout(() => {
			this.statusRefreshTimeout = null;
			this.refreshStatusBadges();
		}, 500);
	}

	refreshStatusBadges() {
		if (!this.settings.showStatusBadge) {
			this.clearStatusBadges();
			return;
		}

		const cwd = this.getVaultPathSafe();
		if (!cwd) return;

		getFileStatuses(cwd, this.settings.gitPath).then((statuses) => {
			this.currentStatuses = statuses;
			// Use full update if first time, otherwise use diff
			if (this.previousStatuses.size === 0) {
				this.updateBadgesInDOM();
			} else {
				this.updateBadgesDiff();
			}
		}).catch(() => {
			// Ignore errors
		});
	}

	private clearStatusBadges() {
		document.querySelectorAll(".git-status-badge").forEach((el) => el.remove());
		this.currentStatuses.clear();
		this.previousStatuses.clear();
	}

	private getMergedStatuses(): Map<string, FileStatus> {
		const merged = new Map(this.currentStatuses);
		this.conflictFiles.forEach((file) => {
			merged.set(file, "U" as FileStatus);
		});

		// Add folder statuses
		const folderStatuses = this.calculateFolderStatuses(merged);
		folderStatuses.forEach((status, path) => {
			merged.set(path, status);
		});

		return merged;
	}

	private updateBadgesDiff() {
		const newStatuses = this.getMergedStatuses();

		// Find paths to remove (in previous but not in new, or status changed)
		for (const [path, oldStatus] of this.previousStatuses) {
			const newStatus = newStatuses.get(path);
			if (!newStatus || newStatus !== oldStatus) {
				this.removeBadgeFromPath(path);
			}
		}

		// Find paths to add/update (in new but not in previous, or status changed)
		for (const [path, status] of newStatuses) {
			const oldStatus = this.previousStatuses.get(path);
			if (oldStatus !== status) {
				this.updateBadgeForPath(path, status);
			}
		}

		this.previousStatuses = newStatuses;
	}

	private removeBadgeFromPath(path: string) {
		const escapedPath = CSS.escape(path);
		const selector = `.nav-file-title[data-path="${escapedPath}"], .nav-folder-title[data-path="${escapedPath}"]`;
		const el = document.querySelector(selector);
		if (el) {
			const badge = el.querySelector(".git-status-badge");
			if (badge) badge.remove();
		}
	}

	private updateBadgeForPath(path: string, status: FileStatus) {
		const escapedPath = CSS.escape(path);
		const selector = `.nav-file-title[data-path="${escapedPath}"], .nav-folder-title[data-path="${escapedPath}"]`;
		const el = document.querySelector(selector);
		if (el) {
			// Remove existing badge if any
			const existingBadge = el.querySelector(".git-status-badge");
			if (existingBadge) existingBadge.remove();
			// Add new badge
			this.addBadgeToElement(el, status);
		}
	}

	private updateBadgesInDOM() {
		// Remove old badges
		document.querySelectorAll(".git-status-badge").forEach((el) => el.remove());

		// Merge conflict files into statuses with highest priority
		const mergedStatuses = new Map(this.currentStatuses);
		this.conflictFiles.forEach((file) => {
			mergedStatuses.set(file, "U" as FileStatus); // U for unmerged/conflict
		});

		// Calculate folder statuses from merged statuses
		const folderStatuses = this.calculateFolderStatuses(mergedStatuses);

		// Add badges to files
		document.querySelectorAll(".nav-file-title").forEach((item) => {
			const pathAttr = item.getAttribute("data-path");
			if (!pathAttr) return;

			const status = mergedStatuses.get(pathAttr);
			if (status) {
				this.addBadgeToElement(item, status);
			}
		});

		// Add badges to folders
		document.querySelectorAll(".nav-folder-title").forEach((item) => {
			const pathAttr = item.getAttribute("data-path");
			if (!pathAttr) return;

			const status = folderStatuses.get(pathAttr);
			if (status) {
				this.addBadgeToElement(item, status);
			}
		});

		// Update previous statuses for diff tracking
		this.previousStatuses = this.getMergedStatuses();
	}

	private calculateFolderStatuses(statuses: Map<string, FileStatus>): Map<string, FileStatus> {
		const folderStatuses = new Map<string, FileStatus>();

		statuses.forEach((status, filePath) => {
			// Get all parent folders
			const parts = filePath.split(/[/\\]/);
			for (let i = 1; i < parts.length; i++) {
				const folderPath = parts.slice(0, i).join("/");
				const existing = folderStatuses.get(folderPath);
				// Priority: U (conflict) > A > M > R > D
				if (!existing || this.statusPriority(status) > this.statusPriority(existing)) {
					folderStatuses.set(folderPath, status);
				}
			}
		});

		return folderStatuses;
	}

	private statusPriority(status: FileStatus): number {
		switch (status) {
			case "U": return 4; // Conflict - highest priority
			case "A": return 3;
			case "M": return 2;
			case "R": return 1;
			default: return 0;
		}
	}

	private addBadgeToElement(item: Element, status: FileStatus) {
		const badge = document.createElement("span");
		badge.className = "git-status-badge";
		badge.textContent = "●";

		if (status === "U") {
			badge.classList.add("conflict");
		} else if (status === "M") {
			badge.classList.add("modified");
		} else if (status === "A") {
			badge.classList.add("added");
		} else if (status === "R") {
			badge.classList.add("renamed");
		}

		item.appendChild(badge);
	}
}
