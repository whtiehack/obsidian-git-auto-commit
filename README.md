# Auto Git Commit

English | [中文](README_zh.md)

A lightweight Obsidian plugin that automatically commits vault changes to git. **Desktop only** (mobile users can access version history via git web interfaces).

> **Design Philosophy**: This plugin stays minimal and focused. It does one thing well: automatic git commits. No bloat, no complexity—just simple, reliable version control for your notes.

## Features

- **Setup Wizard**: Guides new users through repository setup based on current state
- **Auto Commit**: Automatically commit changes after file modifications (with debounce)
- **Auto Pull**: Optionally pull from remote when Obsidian opens
- **Auto Push**: Optionally push to remote after commit
- **Manual Operations**: Commands for manual pull, commit, and push
- **Ribbon Button**: Quick access menu for Git actions (pull, commit, push, revert)
- **File Context Menu**: Right-click modified files to revert individual changes
- **Conflict Detection**: Detect merge conflicts and pause auto-commit until resolved
- **Git Status Badges**: Show colored dots next to modified/new files in file explorer
- **Repository Management**: Initialize repo and configure remote URL from settings
- **Custom Template**: Configurable commit message with variables
- **File List**: Optionally include changed file list in commit body
- **i18n**: English and Chinese UI support

## Installation

### From GitHub Releases (Recommended)

1. Go to [Releases](https://github.com/whtiehack/obsidian-git-auto-commit/releases)
2. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
3. Create folder `<vault>/.obsidian/plugins/auto-git-commit/`
4. Copy downloaded files into the folder
5. Restart Obsidian and enable the plugin in Settings → Community plugins

### Build from Source

```bash
git clone https://github.com/whtiehack/obsidian-git-auto-commit.git
cd obsidian-git-auto-commit
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

## Commands

| Command | Description |
|---------|-------------|
| `Commit now` | Commit all changes |
| `Commit and push` | Commit and push to remote |
| `Pull now` | Pull from remote |
| `Push now` | Push to remote |
| `Mark conflicts as resolved` | Mark conflicts as resolved (only shown when conflicts exist) |

## Settings

### Automation

| Option | Description | Default |
|--------|-------------|---------|
| Auto pull on open | Pull from remote when Obsidian opens | Off |
| Commit and push on close | Commit and push when Obsidian closes (may cause brief delay) | Off |
| Enable auto commit | Auto commit after file changes | Off |
| Debounce delay (seconds) | Wait time before committing | 30 |
| Auto push after commit | Push to remote after commit | Off |

### Configuration

| Option | Description | Default |
|--------|-------------|---------|
| Commit message template | Custom message format | `vault backup: {{date}} {{time}}` |
| Include file list in commit body | List changed files in body | On |
| Show git status in file explorer | Display colored dots next to changed files | On |
| Badge refresh interval (seconds) | Detect external git changes. Set to 0 if you only use Obsidian | 0 |
| Show ribbon button | Add Git actions menu to left ribbon | On |
| Git binary path | Path to git executable | `git` |
| Ignore config directory | Exclude Obsidian config folder from triggers | On |
| Debug logging | Log git commands to console (Ctrl+Shift+I to view) | Off |

### Setup (for new users)

The plugin detects your repository state and shows relevant options:

| State | Description | Options |
|-------|-------------|---------|
| Not a repo | Vault is not a git repository | Connect to remote / Create new repo / Local only |
| Empty repo | Git initialized but no commits | Connect to remote / Create new repo |
| Local only | Has commits but no remote | Add remote and push |
| No upstream | Remote configured but no upstream branch | Set upstream |
| Ready | Fully configured | (Setup section hidden) |

### Repository

- **Pull**: Pull from remote repository
- **Commit**: Commit all changes
- **Push**: Push to remote repository
- **Remote URL**: Configure remote repository URL
- **Initialize**: Initialize git repository (if not initialized)
- **Resolve Conflicts**: Mark conflicts as resolved (only shown when conflicts exist)

## Git Status Badges

Colored dots (●) are displayed next to files in the file explorer:

| Color | Status |
|-------|--------|
| ![Modified](badges/modified.svg) Yellow | Modified |
| ![Added](badges/added.svg) Green | New/Added |
| ![Conflict](badges/conflict.svg) Red | Conflict |
| ![Renamed](badges/renamed.svg) Blue | Renamed |

Folders show the highest priority status of their contents.

## Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{date}}` | ISO date | `2025-12-20` |
| `{{time}}` | Time (HH:MM:SS) | `10:30:00` |
| `{{files}}` | Changed files (max 5) | `a.md, b.md, ...` |
| `{{count}}` | Number of changed files | `3` |

## Requirements

- Obsidian 1.2.0+
- **Desktop only** (Windows / macOS / Linux)
- Git installed and accessible

> **Why no mobile support?** Mobile platforms lack native Git. While [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) exists, it has significant limitations: CORS restrictions requiring proxy servers, Buffer compatibility issues, and severe performance problems. For mobile users, we recommend using your git hosting provider's web interface or mobile app (GitHub, GitLab, Gitea, etc.) to view and manage your vault's version history.

## License

MIT
