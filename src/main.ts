import { EventRef, Notice, Platform, Plugin, TAbstractFile, TFile, FileSystemAdapter } from "obsidian";
import { AutoGitSettings, AutoGitSettingTab, DEFAULT_SETTINGS } from "./settings";
import { getChangedFiles, commitAll, push, pull, getFileStatuses, getConflictFiles, hasConflicts, markConflictsResolved, FileStatus } from "./git";
import { renderTemplate } from "./template";
import { t } from "./i18n";

export default class AutoGitPlugin extends Plugin {
	settings: AutoGitSettings = DEFAULT_SETTINGS;

	private debounceTimer: number | null = null;
	private isCommitting = false;
	private pendingRerun = false;
	private vaultEventRefs: EventRef[] = [];
	private statusRefreshInterval: number | null = null;
	private currentStatuses: Map<string, FileStatus> = new Map();
	private conflictFiles: Set<string> = new Set();
	private _hasConflicts = false;
	private resolveConflictCommand: { id: string } | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AutoGitSettingTab(this.app, this));

		this.addCommand({
			id: "commit-now",
			name: "Commit now",
			callback: () => this.runCommit("manual"),
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
			callback: () => this.doPull(),
		});

		this.setupVaultListeners();
		this.setupStatusBadges();

		// Auto pull on open
		if (this.settings.autoPullOnOpen && !Platform.isMobileApp) {
			// Delay to ensure vault is ready
			window.setTimeout(() => this.doPull(), 1000);
		}

		// Check for existing conflicts on load
		this.checkConflicts();
	}

	onunload() {
		this.clearDebounce();
		this.removeVaultListeners();
		this.clearStatusBadges();
		if (this.statusRefreshInterval) {
			window.clearInterval(this.statusRefreshInterval);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
		if (!this.settings.autoCommit) return;

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

		this.scheduleCommit();
		this.scheduleStatusRefresh();
	}

	private shouldIgnore(path: string): boolean {
		if (path.startsWith(".git/") || path.startsWith(".git\\")) return true;
		if (this.settings.ignoreObsidianDir) {
			if (path.startsWith(".obsidian/") || path.startsWith(".obsidian\\")) return true;
		}
		return false;
	}

	private scheduleCommit() {
		this.clearDebounce();
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.runCommit("auto");
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

	private async doPull() {
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
		} else if (!value && this.resolveConflictCommand) {
			// Remove command when no conflicts - Note: Obsidian doesn't support removing commands
			// So we just clear the reference
			this.resolveConflictCommand = null;
		}

		if (!value) {
			this.conflictFiles.clear();
		}
	}

	// Status badge functionality
	private setupStatusBadges() {
		if (Platform.isMobileApp || !this.settings.showStatusBadge) return;

		// Initial refresh
		this.refreshStatusBadges();

		// Refresh every 5 seconds
		this.statusRefreshInterval = window.setInterval(() => {
			this.refreshStatusBadges();
		}, 5000);
	}

	private scheduleStatusRefresh() {
		if (!this.settings.showStatusBadge) return;
		// Debounced refresh after file change
		window.setTimeout(() => this.refreshStatusBadges(), 500);
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
			this.updateBadgesInDOM();
		});
	}

	private clearStatusBadges() {
		document.querySelectorAll(".git-status-badge").forEach((el) => el.remove());
		this.currentStatuses.clear();
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
	}

	private calculateFolderStatuses(statuses?: Map<string, FileStatus>): Map<string, FileStatus> {
		const sourceStatuses = statuses || this.currentStatuses;
		const folderStatuses = new Map<string, FileStatus>();

		sourceStatuses.forEach((status, filePath) => {
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
			case "U": return 5; // Conflict - highest priority
			case "A": return 4;
			case "M": return 3;
			case "R": return 2;
			case "D": return 1;
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
		} else if (status === "D") {
			badge.classList.add("deleted");
		} else if (status === "R") {
			badge.classList.add("renamed");
		}

		item.appendChild(badge);
	}
}
