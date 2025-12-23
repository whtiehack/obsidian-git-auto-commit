import { FileStatus, getFileStatuses, getTrackedFiles } from "./git";

export interface StatusBadgeOptions {
	getCwd: () => string | null;
	getGitPath: () => string;
	shouldIgnore: (path: string) => boolean;
}

export class GitStatusBadgeManager {
	private enabled = false;
	private pollInterval = 0;

	private fileStatuses = new Map<string, FileStatus>();
	private folderStatuses = new Map<string, FileStatus>();
	private trackedFiles = new Set<string>();
	private trackedLoaded = false;
	private conflicts = new Set<string>();

	private pollId: number | null = null;
	private retryId: number | null = null;
	private rafId: number | null = null;
	private observer: MutationObserver | null = null;

	constructor(private opts: StatusBadgeOptions) {}

	start(enabled: boolean, pollIntervalSeconds: number): void {
		this.stop();
		this.enabled = enabled;
		this.pollInterval = pollIntervalSeconds;

		if (!this.enabled) return;

		this.attachObserver(0);
		void this.refresh();

		if (this.pollInterval > 0) {
			this.pollId = window.setInterval(() => {
				void this.refresh();
			}, this.pollInterval * 1000);
		}
	}

	stop(): void {
		this.enabled = false;

		if (this.pollId) {
			window.clearInterval(this.pollId);
			this.pollId = null;
		}
		if (this.retryId) {
			window.clearTimeout(this.retryId);
			this.retryId = null;
		}
		if (this.rafId) {
			window.cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}

		this.fileStatuses.clear();
		this.folderStatuses.clear();
		this.trackedFiles.clear();
		this.trackedLoaded = false;
		this.conflicts.clear();
		this.clearDom();
	}

	setConflicts(files: Set<string>): void {
		this.conflicts = new Set([...files].filter((p) => !this.opts.shouldIgnore(p)));
		this.rebuildFolderStatuses();
		this.queueRender();
	}

	getStatus(path: string): FileStatus {
		if (!this.enabled || this.opts.shouldIgnore(path)) return "";
		if (this.conflicts.has(path)) return "U";
		return this.fileStatuses.get(path) ?? "";
	}

	noteCreate(path: string): void {
		if (!this.enabled || this.opts.shouldIgnore(path)) return;
		if (!this.trackedLoaded) return;
		this.fileStatuses.set(path, this.trackedFiles.has(path) ? "M" : "A");
		this.rebuildFolderStatuses();
		this.queueRender();
	}

	noteModify(path: string): void {
		if (!this.enabled || this.opts.shouldIgnore(path)) return;
		if (!this.trackedLoaded) return;
		const cur = this.fileStatuses.get(path);
		if (cur === "A" || cur === "R") return;
		this.fileStatuses.set(path, "M");
		this.rebuildFolderStatuses();
		this.queueRender();
	}

	noteDelete(path: string): void {
		if (!this.enabled || this.opts.shouldIgnore(path)) return;
		this.fileStatuses.delete(path);
		this.conflicts.delete(path);
		this.rebuildFolderStatuses();
		this.queueRender();
	}

	noteRename(oldPath: string, newPath: string): void {
		if (!this.enabled) return;
		if (this.opts.shouldIgnore(oldPath) && this.opts.shouldIgnore(newPath)) return;

		this.fileStatuses.delete(oldPath);
		this.conflicts.delete(oldPath);

		if (!this.opts.shouldIgnore(newPath) && this.trackedLoaded) {
			const wasTracked = this.trackedFiles.has(oldPath);
			if (wasTracked) {
				this.trackedFiles.delete(oldPath);
				this.trackedFiles.add(newPath);
			}
			this.fileStatuses.set(newPath, wasTracked ? "R" : "A");
		}

		this.rebuildFolderStatuses();
		this.queueRender();
	}

	async refresh(): Promise<void> {
		if (!this.enabled) return;

		const cwd = this.opts.getCwd();
		if (!cwd) return;

		try {
			const [statuses, tracked] = await Promise.all([
				getFileStatuses(cwd, this.opts.getGitPath()),
				getTrackedFiles(cwd, this.opts.getGitPath()),
			]);

			if (!this.enabled) return;

			this.fileStatuses = new Map(
				[...statuses].filter(([p]) => !this.opts.shouldIgnore(p))
			);
			this.trackedFiles = tracked;
			this.trackedLoaded = true;

			this.rebuildFolderStatuses();
			this.queueRender();
		} catch {
			// Keep last known state
		}
	}

	private attachObserver(retry: number): void {
		if (!this.enabled) return;

		const container = document.querySelector(".nav-files-container");
		if (!container) {
			if (retry < 10) {
				this.retryId = window.setTimeout(() => {
					this.retryId = null;
					this.attachObserver(retry + 1);
				}, 200);
			}
			return;
		}

		this.observer = new MutationObserver(() => this.queueRender());
		this.observer.observe(container, { childList: true, subtree: true });
		this.queueRender();
	}

	private queueRender(): void {
		if (!this.enabled || this.rafId) return;
		this.rafId = window.requestAnimationFrame(() => {
			this.rafId = null;
			this.render();
		});
	}

	private render(): void {
		if (!this.enabled) return;

		document.querySelectorAll<HTMLElement>(
			".nav-file-title[data-path], .nav-folder-title[data-path]"
		).forEach((el) => {
			const path = el.getAttribute("data-path");
			if (!path) return;

			let badge = el.querySelector<HTMLElement>(".git-status-badge");

			if (this.opts.shouldIgnore(path)) {
				if (badge) badge.remove();
				return;
			}

			let status: FileStatus = "";
			if (el.classList.contains("nav-file-title")) {
				status = this.conflicts.has(path) ? "U" : (this.fileStatuses.get(path) ?? "");
			} else {
				status = this.folderStatuses.get(path) ?? "";
			}

			if (status) {
				if (!badge) {
					badge = document.createElement("span");
					badge.className = "git-status-badge";
					el.appendChild(badge);
				}
				badge.setAttribute("data-status", status);
			} else if (badge) {
				badge.remove();
			}
		});
	}

	private clearDom(): void {
		document.querySelectorAll(".git-status-badge").forEach((el) => el.remove());
	}

	private rebuildFolderStatuses(): void {
		const merged = new Map(this.fileStatuses);
		this.conflicts.forEach((p) => merged.set(p, "U"));

		const folders = new Map<string, FileStatus>();
		merged.forEach((status, filePath) => {
			const parts = filePath.split(/[/\\]/);
			for (let i = 1; i < parts.length; i++) {
				const folder = parts.slice(0, i).join("/");
				const cur = folders.get(folder);
				if (!cur || this.priority(status) > this.priority(cur)) {
					folders.set(folder, status);
				}
			}
		});

		this.folderStatuses = folders;
	}

	private priority(s: FileStatus): number {
		switch (s) {
			case "U": return 4;
			case "A": return 3;
			case "M": return 2;
			case "R": return 1;
			default: return 0;
		}
	}
}
