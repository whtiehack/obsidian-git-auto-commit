type Translations = {
	// Settings tab
	settingsTitle: string;
	sectionAutomation: string;
	sectionConfiguration: string;

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

	// Notices
	noticeNoChanges: string;
	noticeCommitted: (count: number) => string;
	noticePushed: string;
	noticeAutoGitError: (msg: string) => string;
	noticePushFailed: (msg: string) => string;
	noticeMobileNotSupported: string;
	noticeDesktopOnly: string;
};

const en: Translations = {
	settingsTitle: "Auto Git Commit",
	sectionAutomation: "Automation",
	sectionConfiguration: "Configuration",

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

	noticeNoChanges: "No changes to commit.",
	noticeCommitted: (count) => `Committed ${count} file(s).`,
	noticePushed: "Pushed to remote.",
	noticeAutoGitError: (msg) => `Auto Git error: ${msg}`,
	noticePushFailed: (msg) => `Push failed: ${msg}`,
	noticeMobileNotSupported: "Auto Git: Git not available on mobile.",
	noticeDesktopOnly: "Auto Git requires desktop vault.",
};

const zhCN: Translations = {
	settingsTitle: "自动 Git 提交",
	sectionAutomation: "自动化",
	sectionConfiguration: "配置",

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

	noticeNoChanges: "没有可提交的更改。",
	noticeCommitted: (count) => `已提交 ${count} 个文件。`,
	noticePushed: "已推送到远程仓库。",
	noticeAutoGitError: (msg) => `自动 Git 错误: ${msg}`,
	noticePushFailed: (msg) => `推送失败: ${msg}`,
	noticeMobileNotSupported: "自动 Git: 移动端不支持 Git。",
	noticeDesktopOnly: "自动 Git 需要桌面端。",
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
