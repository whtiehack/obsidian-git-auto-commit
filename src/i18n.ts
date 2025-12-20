type Translations = {
	// Settings tab
	settingsTitle: string;
	sectionAutomation: string;
	sectionConfiguration: string;
	sectionRepository: string;

	autoCommitName: string;
	autoCommitDesc: string;

	debounceName: string;
	debounceDesc: string;

	autoPushName: string;
	autoPushDesc: string;

	templateName: string;
	templateDesc: string;

	gitPathName: string;
	gitPathDesc: string;

	ignoreObsidianName: string;
	ignoreObsidianDesc: string;

	includeFileListName: string;
	includeFileListDesc: string;

	showStatusBadgeName: string;
	showStatusBadgeDesc: string;

	// Repository
	repoStatusName: string;
	repoNotInitialized: string;
	repoInitialized: string;
	initRepoButton: string;
	remoteUrlName: string;
	remoteUrlDesc: string;
	remoteUrlPlaceholder: string;
	saveButton: string;

	// Notices
	noticeNoChanges: string;
	noticeCommitted: (count: number) => string;
	noticePushed: string;
	noticeAutoGitError: (msg: string) => string;
	noticePushFailed: (msg: string) => string;
	noticeMobileNotSupported: string;
	noticeDesktopOnly: string;
	noticeRepoInitialized: string;
	noticeRemoteSaved: string;
};

const en: Translations = {
	settingsTitle: "Auto Git Commit",
	sectionAutomation: "Automation",
	sectionConfiguration: "Configuration",
	sectionRepository: "Repository",

	autoCommitName: "Enable auto commit",
	autoCommitDesc: "Automatically commit when files change (debounced).",

	debounceName: "Debounce delay (seconds)",
	debounceDesc: "Wait time after last change before committing.",

	autoPushName: "Auto push after commit",
	autoPushDesc: "Push to remote after successful commit.",

	templateName: "Commit message template",
	templateDesc: "Variables: {{date}}, {{time}}, {{files}}, {{count}}",

	gitPathName: "Git binary path",
	gitPathDesc: "Path to git executable. Default: git",

	ignoreObsidianName: "Ignore .obsidian directory",
	ignoreObsidianDesc: "Exclude config folder from triggering auto-commits.",

	includeFileListName: "Include file list in commit body",
	includeFileListDesc: "List changed files in commit message body, one per line.",

	showStatusBadgeName: "Show git status in file explorer",
	showStatusBadgeDesc: "Display colored dots next to changed files and folders.",

	repoStatusName: "Repository status",
	repoNotInitialized: "Not a git repository",
	repoInitialized: "Git repository initialized",
	initRepoButton: "Initialize repository",
	remoteUrlName: "Remote URL (origin)",
	remoteUrlDesc: "Set the remote repository URL for push.",
	remoteUrlPlaceholder: "https://github.com/user/repo.git",
	saveButton: "Save",

	noticeNoChanges: "GitAutoCommit: No changes to commit.",
	noticeCommitted: (count) => `GitAutoCommit: Committed ${count} file(s).`,
	noticePushed: "GitAutoCommit: Pushed to remote.",
	noticeAutoGitError: (msg) => `GitAutoCommit: Error - ${msg}`,
	noticePushFailed: (msg) => `GitAutoCommit: Push failed - ${msg}`,
	noticeMobileNotSupported: "GitAutoCommit: Git not available on mobile.",
	noticeDesktopOnly: "GitAutoCommit: Requires desktop vault.",
	noticeRepoInitialized: "GitAutoCommit: Repository initialized.",
	noticeRemoteSaved: "GitAutoCommit: Remote URL saved.",
};

const zhCN: Translations = {
	settingsTitle: "自动 Git 提交",
	sectionAutomation: "自动化",
	sectionConfiguration: "配置",
	sectionRepository: "仓库",

	autoCommitName: "启用自动提交",
	autoCommitDesc: "文件变动后自动提交（防抖）。",

	debounceName: "防抖延迟（秒）",
	debounceDesc: "最后一次变动后等待多久再提交。",

	autoPushName: "提交后自动推送",
	autoPushDesc: "提交成功后自动推送到远程仓库。",

	templateName: "提交消息模板",
	templateDesc: "变量: {{date}}, {{time}}, {{files}}, {{count}}",

	gitPathName: "Git 可执行文件路径",
	gitPathDesc: "git 的路径，默认: git",

	ignoreObsidianName: "忽略 .obsidian 目录",
	ignoreObsidianDesc: "排除配置文件夹触发自动提交。",

	includeFileListName: "在提交正文中包含文件列表",
	includeFileListDesc: "在提交消息正文中列出变动的文件，每行一个。",

	showStatusBadgeName: "在文件列表显示 Git 状态",
	showStatusBadgeDesc: "在变动的文件和文件夹旁显示彩色圆点。",

	repoStatusName: "仓库状态",
	repoNotInitialized: "尚未初始化为 Git 仓库",
	repoInitialized: "Git 仓库已初始化",
	initRepoButton: "初始化仓库",
	remoteUrlName: "远程仓库地址 (origin)",
	remoteUrlDesc: "设置用于推送的远程仓库地址。",
	remoteUrlPlaceholder: "https://github.com/user/repo.git",
	saveButton: "保存",

	noticeNoChanges: "GitAutoCommit: 没有可提交的更改。",
	noticeCommitted: (count) => `GitAutoCommit: 已提交 ${count} 个文件。`,
	noticePushed: "GitAutoCommit: 已推送到远程仓库。",
	noticeAutoGitError: (msg) => `GitAutoCommit: 错误 - ${msg}`,
	noticePushFailed: (msg) => `GitAutoCommit: 推送失败 - ${msg}`,
	noticeMobileNotSupported: "GitAutoCommit: 移动端不支持 Git。",
	noticeDesktopOnly: "GitAutoCommit: 需要桌面端。",
	noticeRepoInitialized: "GitAutoCommit: 仓库已初始化。",
	noticeRemoteSaved: "GitAutoCommit: 远程地址已保存。",
};

const translations: Record<string, Translations> = {
	en,
	zh: zhCN,
	"zh-CN": zhCN,
	"zh-TW": zhCN,
};

function getObsidianLocale(): string {
	// @ts-ignore - Obsidian internal API
	return window.localStorage.getItem("language") || "en";
}

export function t(): Translations {
	const locale = getObsidianLocale();
	return translations[locale] || translations["en"];
}
