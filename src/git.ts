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

export async function push(cwd: string, gitPath: string): Promise<void> {
	await runGit({ cwd, gitPath, args: ["push"] });
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
