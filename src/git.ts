import { execFile } from "child_process";

interface GitRunOptions {
	cwd: string;
	gitPath: string;
	args: string[];
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

export async function getChangedFiles(cwd: string, gitPath: string): Promise<string[]> {
	const stdout = await runGit({ cwd, gitPath, args: ["status", "--porcelain=v1", "-z"] });
	if (!stdout) return [];

	const parts = stdout.split("\0").filter(Boolean);
	const files: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		const statusCode = entry.slice(0, 2);
		const filePath = entry.slice(3);

		if (filePath) files.push(filePath);

		// Handle rename/copy entries (have additional NUL-separated path)
		if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
			const newPath = parts[++i];
			if (newPath) files.push(newPath);
		}
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

async function getCurrentBranch(cwd: string, gitPath: string): Promise<string> {
	const stdout = await runGit({ cwd, gitPath, args: ["rev-parse", "--abbrev-ref", "HEAD"] });
	return stdout.trim();
}

export async function push(cwd: string, gitPath: string): Promise<void> {
	const branch = await getCurrentBranch(cwd, gitPath);
	await runGit({ cwd, gitPath, args: ["push", "-u", "origin", branch] });
}

export interface PullResult {
	success: boolean;
	hasConflicts: boolean;
	message: string;
}

export async function pull(cwd: string, gitPath: string): Promise<PullResult> {
	try {
		const branch = await getCurrentBranch(cwd, gitPath);
		const stdout = await runGit({ cwd, gitPath, args: ["pull", "origin", branch] });
		return { success: true, hasConflicts: false, message: stdout };
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

export type FileStatus = "M" | "A" | "R" | "U" | "?" | "";

export async function getFileStatuses(cwd: string, gitPath: string): Promise<Map<string, FileStatus>> {
	const statusMap = new Map<string, FileStatus>();

	try {
		const stdout = await runGit({ cwd, gitPath, args: ["status", "--porcelain=v1", "-z"] });
		if (!stdout) return statusMap;

		const parts = stdout.split("\0").filter(Boolean);

		for (let i = 0; i < parts.length; i++) {
			const entry = parts[i];
			const xy = entry.slice(0, 2);
			const filePath = entry.slice(3);

			// Determine status: X is staged, Y is unstaged
			// We show the most relevant status
			let status: FileStatus = "";

			if (xy === "??" || xy.includes("?")) {
				status = "A"; // Untracked = new file
			} else if (xy.includes("A")) {
				status = "A"; // Added
			} else if (xy.includes("R")) {
				status = "R"; // Renamed
			} else if (xy.includes("M") || xy.includes("U")) {
				status = "M"; // Modified
			}

			if (filePath && status) {
				statusMap.set(filePath, status);
			}

			// Handle rename (has extra path)
			if (xy.startsWith("R") || xy.startsWith("C")) {
				i++;
			}
		}
	} catch {
		// Not a git repo or git error
	}

	return statusMap;
}
