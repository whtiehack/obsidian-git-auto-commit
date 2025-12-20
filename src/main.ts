import { EventRef, Notice, Platform, Plugin, TAbstractFile, TFile, FileSystemAdapter } from "obsidian";
import { AutoGitSettings, AutoGitSettingTab, DEFAULT_SETTINGS } from "./settings";
import { getChangedFiles, commitAll, push } from "./git";
import { renderTemplate } from "./template";
import { t } from "./i18n";

export default class AutoGitPlugin extends Plugin {
	settings: AutoGitSettings = DEFAULT_SETTINGS;

	private debounceTimer: number | null = null;
	private isCommitting = false;
	private pendingRerun = false;
	private vaultEventRefs: EventRef[] = [];

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

		this.setupVaultListeners();
	}

	onunload() {
		this.clearDebounce();
		this.removeVaultListeners();
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

	private async doPush() {
		try {
			const cwd = this.getVaultPath();
			await push(cwd, this.settings.gitPath);
			new Notice(t().noticePushed);
		} catch (e) {
			new Notice(t().noticePushFailed((e as Error).message));
		}
	}
}
