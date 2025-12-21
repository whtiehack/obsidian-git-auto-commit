import { execFile, execFileSync, spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";

interface GitRunOptions {
	cwd: string;
	gitPath: string;
	args: string[];
}

function runGitSync({ cwd, gitPath, args }: GitRunOptions): string {
	return execFileSync(gitPath, args, {
		cwd,
		windowsHide: true,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		encoding: "utf8",
	});
}

function runGit({ cwd, gitPath, args }: GitRunOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			gitPath,
			args,
			{
				cwd,
				windowsHide: true,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
			},
			(err, stdout, stderr) => {
				if (err) {
					reject(new Error(stderr?.trim() || err.message));
					return;
				}
				resolve(stdout);
			}
		);
	});
}

async function ensureGitignore(cwd: string, ignoreDir?: string): Promise<void> {
	if (!ignoreDir) return;

	const gitignorePath = path.join(cwd, ".gitignore");
	const ignorePattern = ignoreDir.endsWith("/") ? ignoreDir : `${ignoreDir}/`;

	let content = "";
	try {
		content = await fs.readFile(gitignorePath, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}

	const lines = content.split(/\r?\n/);
	if (lines.some((line) => line.trim() === ignorePattern)) return;

	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const prefix = content.length > 0 && !content.endsWith("\n") ? eol : "";
	await fs.writeFile(gitignorePath, `${content}${prefix}${ignorePattern}${eol}`, "utf8");
}

// Repo state detection
export type RepoState =
	| "not-a-repo"
	| "empty-repo"
	| "local-only"
	| "remote-no-upstream"
	| "ready";

export async function detectRepoState(cwd: string, gitPath: string): Promise<RepoState> {
	// Check if it's a git repo
	if (!(await isGitRepo(cwd, gitPath))) {
		return "not-a-repo";
	}

	// Check if there are any commits
	try {
		await runGit({ cwd, gitPath, args: ["rev-parse", "HEAD"] });
	} catch {
		return "empty-repo";
	}

	// Check if remote is configured
	const remoteUrl = await getRemoteUrl(cwd, gitPath);
	if (!remoteUrl) {
		return "local-only";
	}

	// Check if upstream is set
	try {
		await runGit({ cwd, gitPath, args: ["rev-parse", "--abbrev-ref", "@{u}"] });
		return "ready";
	} catch {
		return "remote-no-upstream";
	}
}

export async function getChangedFiles(cwd: string, gitPath: string): Promise<string[]> {
	const stdout = await runGit({ cwd, gitPath, args: ["status", "--porcelain=v1", "-z"] });
	if (!stdout) return [];

	const parts = stdout.split("\0").filter(Boolean);
	const files: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		const statusCode = entry.slice(0, 2);
		const filePath = entry.slice(3);

		// Handle rename/copy entries (have additional NUL-separated path for new name)
		if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
			const newPath = parts[++i];
			if (newPath) files.push(newPath);
			continue;
		}
		if (filePath) files.push(filePath);
	}

	return [...new Set(files)];
}

export async function commitAll(cwd: string, gitPath: string, message: string): Promise<void> {
	await runGit({ cwd, gitPath, args: ["add", "-A"] });

	try {
		await runGit({ cwd, gitPath, args: ["commit", "-m", message] });
	} catch (e) {
		const msg = (e as Error).message;
		if (msg.includes("nothing to commit") || msg.includes("no changes added")) {
			return;
		}
		throw e;
	}
}

export async function push(cwd: string, gitPath: string): Promise<void> {
	const branch = await getCurrentBranch(cwd, gitPath);
	await runGit({ cwd, gitPath, args: ["push", "-u", "origin", branch] });
}

export interface PullResult {
	success: boolean;
	hasConflicts: boolean;
	message: string;
	notReady?: boolean;
}

export async function pull(cwd: string, gitPath: string): Promise<PullResult> {
	// Check repo state first
	const state = await detectRepoState(cwd, gitPath);
	if (state !== "ready") {
		return {
			success: false,
			hasConflicts: false,
			message: `Repository not ready: ${state}`,
			notReady: true
		};
	}

	try {
		// Try to use upstream first
		try {
			const stdout = await runGit({ cwd, gitPath, args: ["pull"] });
			return { success: true, hasConflicts: false, message: stdout };
		} catch {
			// Fallback to explicit origin/branch
			const branch = await getCurrentBranch(cwd, gitPath);
			const stdout = await runGit({ cwd, gitPath, args: ["pull", "origin", branch] });
			return { success: true, hasConflicts: false, message: stdout };
		}
	} catch (e) {
		const msg = (e as Error).message;
		if (msg.includes("CONFLICT") || msg.includes("Merge conflict")) {
			return { success: false, hasConflicts: true, message: msg };
		}
		throw e;
	}
}

export async function getConflictFiles(cwd: string, gitPath: string): Promise<string[]> {
	try {
		const stdout = await runGit({ cwd, gitPath, args: ["diff", "--name-only", "--diff-filter=U"] });
		return stdout.split("\n").map(f => f.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

export async function hasConflicts(cwd: string, gitPath: string): Promise<boolean> {
	const files = await getConflictFiles(cwd, gitPath);
	return files.length > 0;
}

export async function markConflictsResolved(cwd: string, gitPath: string): Promise<void> {
	await runGit({ cwd, gitPath, args: ["add", "-A"] });
}

export async function isGitRepo(cwd: string, gitPath: string): Promise<boolean> {
	try {
		await runGit({ cwd, gitPath, args: ["rev-parse", "--git-dir"] });
		return true;
	} catch {
		return false;
	}
}

export async function initRepo(cwd: string, gitPath: string): Promise<void> {
	await runGit({ cwd, gitPath, args: ["init"] });
}

export async function getRemoteUrl(cwd: string, gitPath: string): Promise<string> {
	try {
		const stdout = await runGit({ cwd, gitPath, args: ["remote", "get-url", "origin"] });
		return stdout.trim();
	} catch {
		return "";
	}
}

export async function setRemoteUrl(cwd: string, gitPath: string, url: string): Promise<void> {
	const currentUrl = await getRemoteUrl(cwd, gitPath);
	if (currentUrl) {
		await runGit({ cwd, gitPath, args: ["remote", "set-url", "origin", url] });
	} else {
		await runGit({ cwd, gitPath, args: ["remote", "add", "origin", url] });
	}
}

export async function revertAll(cwd: string, gitPath: string): Promise<void> {
	await runGit({ cwd, gitPath, args: ["checkout", "--", "."] });
	await runGit({ cwd, gitPath, args: ["clean", "-fd"] });
}

export async function revertFile(cwd: string, gitPath: string, filePath: string): Promise<void> {
	try {
		// Try checkout first (for modified files)
		await runGit({ cwd, gitPath, args: ["checkout", "--", filePath] });
	} catch {
		// If checkout fails, it might be an untracked file - remove it
		await runGit({ cwd, gitPath, args: ["clean", "-f", "--", filePath] });
	}
}

export type FileStatus = "M" | "A" | "R" | "U" | "";

export async function getFileStatuses(cwd: string, gitPath: string): Promise<Map<string, FileStatus>> {
	const statusMap = new Map<string, FileStatus>();

	try {
		const stdout = await runGit({ cwd, gitPath, args: ["status", "--porcelain=v1", "-z"] });
		if (!stdout) return statusMap;

		const parts = stdout.split("\0").filter(Boolean);

		for (let i = 0; i < parts.length; i++) {
			const entry = parts[i];
			const xy = entry.slice(0, 2);
			let filePath = entry.slice(3);

			// Rename/copy entries include an extra NUL-separated "new path"
			if (xy.startsWith("R") || xy.startsWith("C")) {
				const newPath = parts[++i];
				if (newPath) filePath = newPath;
			}

			// Determine status: X is staged, Y is unstaged
			let status: FileStatus = "";

			if (xy.includes("U")) {
				status = "U"; // Unmerged / conflict (highest priority)
			} else if (xy === "??") {
				status = "A"; // Untracked = new file
			} else if (xy.includes("A")) {
				status = "A"; // Added
			} else if (xy.includes("M")) {
				status = "M"; // Modified
			} else if (xy.includes("R") || xy.includes("C")) {
				status = "R"; // Renamed / copied
			}

			if (filePath && status) {
				statusMap.set(filePath, status);
			}
		}
	} catch {
		// Not a git repo or git error
	}

	return statusMap;
}

// Get remote default branch (main/master)
export async function getRemoteDefaultBranch(cwd: string, gitPath: string): Promise<string | null> {
	try {
		// Try to get from remote HEAD
		const stdout = await runGit({ cwd, gitPath, args: ["remote", "show", "origin"] });
		const match = stdout.match(/HEAD branch:\s*(\S+)/);
		if (match && match[1] !== "(unknown)") return match[1];
	} catch {
		// Fallback: try common branch names
	}

	// Try to find main or master in remote refs
	try {
		const refs = await runGit({ cwd, gitPath, args: ["ls-remote", "--heads", "origin"] });
		if (!refs.trim()) return null; // Empty remote
		if (refs.includes("refs/heads/main")) return "main";
		if (refs.includes("refs/heads/master")) return "master";
		// Return first branch found
		const match = refs.match(/refs\/heads\/(\S+)/);
		if (match) return match[1];
	} catch {
		// Ignore
	}

	return null; // Remote is empty or unreachable
}

// Initialize repo with first commit and push to empty remote
export async function initAndPush(cwd: string, gitPath: string, url: string, branch: string = "main", ignoreDir?: string): Promise<void> {
	// Initialize with branch name
	await runGit({ cwd, gitPath, args: ["init", "-b", branch] });

	// Ensure .gitignore excludes config dir if specified
	await ensureGitignore(cwd, ignoreDir);

	// Add all files
	await runGit({ cwd, gitPath, args: ["add", "-A"] });

	// Create initial commit
	await runGit({ cwd, gitPath, args: ["commit", "-m", "Initial commit"] });

	// Add remote
	await runGit({ cwd, gitPath, args: ["remote", "add", "origin", url] });

	// Push with upstream
	await runGit({ cwd, gitPath, args: ["push", "-u", "origin", branch] });
}

// Connect to existing remote repo (fetch and checkout)
export async function connectToRemote(cwd: string, gitPath: string, url: string, ignoreDir?: string): Promise<{ branch: string }> {
	// Initialize if needed
	if (!(await isGitRepo(cwd, gitPath))) {
		await runGit({ cwd, gitPath, args: ["init", "-b", "main"] });
	}

	// Add remote
	const currentUrl = await getRemoteUrl(cwd, gitPath);
	if (!currentUrl) {
		await runGit({ cwd, gitPath, args: ["remote", "add", "origin", url] });
	} else if (currentUrl !== url) {
		await runGit({ cwd, gitPath, args: ["remote", "set-url", "origin", url] });
	}

	// Fetch remote
	await runGit({ cwd, gitPath, args: ["fetch", "origin"] });

	// Get remote default branch (null if remote is empty)
	const remoteBranch = await getRemoteDefaultBranch(cwd, gitPath);

	if (!remoteBranch) {
		// Remote is empty - create initial commit and push
		await ensureGitignore(cwd, ignoreDir);
		await runGit({ cwd, gitPath, args: ["add", "-A"] });
		try {
			await runGit({ cwd, gitPath, args: ["commit", "-m", "Initial commit"] });
		} catch (e) {
			// Might fail if no files to commit, that's ok
			const msg = (e as Error).message;
			if (!msg.includes("nothing to commit")) {
				throw e;
			}
		}
		await runGit({ cwd, gitPath, args: ["push", "-u", "origin", "main"] });
		return { branch: "main" };
	}

	// Remote has content - check if we have local commits
	let hasLocalCommits = false;
	try {
		await runGit({ cwd, gitPath, args: ["rev-parse", "HEAD"] });
		hasLocalCommits = true;
	} catch {
		hasLocalCommits = false;
	}

	if (!hasLocalCommits) {
		// No local commits: checkout remote branch directly
		await runGit({ cwd, gitPath, args: ["checkout", "-b", remoteBranch, `origin/${remoteBranch}`] });
	} else {
		// Has local commits: rename branch and set upstream
		try {
			await runGit({ cwd, gitPath, args: ["branch", `-M`, remoteBranch] });
		} catch {
			// Branch might already be named correctly
		}
		await runGit({ cwd, gitPath, args: ["branch", `--set-upstream-to=origin/${remoteBranch}`, remoteBranch] });
	}

	return { branch: remoteBranch };
}

// Set upstream for current branch
export async function setUpstream(cwd: string, gitPath: string): Promise<void> {
	const branch = await getCurrentBranch(cwd, gitPath);
	await runGit({ cwd, gitPath, args: ["push", "-u", "origin", branch] });
}

// Get current branch name
async function getCurrentBranch(cwd: string, gitPath: string): Promise<string> {
	const stdout = await runGit({ cwd, gitPath, args: ["rev-parse", "--abbrev-ref", "HEAD"] });
	return stdout.trim();
}

// Synchronous version for use during app close
export function getChangedFilesSync(cwd: string, gitPath: string): string[] {
	try {
		const stdout = runGitSync({ cwd, gitPath, args: ["status", "--porcelain=v1", "-z"] });
		if (!stdout) return [];
		const parts = stdout.split("\0").filter(Boolean);
		const files: string[] = [];
		for (let i = 0; i < parts.length; i++) {
			const entry = parts[i];
			const statusCode = entry.slice(0, 2);
			const filePath = entry.slice(3);
			if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
				const newPath = parts[++i];
				if (newPath) files.push(newPath);
				continue;
			}
			if (filePath) files.push(filePath);
		}
		return [...new Set(files)];
	} catch {
		return [];
	}
}

// Sync commit only, then spawn detached push process
export function commitSyncAndPushDetached(cwd: string, gitPath: string, message: string): void {
	try {
		runGitSync({ cwd, gitPath, args: ["add", "-A"] });
		runGitSync({ cwd, gitPath, args: ["commit", "-m", message] });
	} catch {
		// Commit failed or nothing to commit
		return;
	}

	// Spawn detached push process that continues after parent exits
	try {
		const child = spawn(gitPath, ["push"], {
			cwd,
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
		child.unref();
	} catch {
		// Ignore spawn errors
	}
}
