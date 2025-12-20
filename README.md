# Auto Git Commit

An Obsidian plugin that automatically commits vault changes to git.

## Features

- **Auto Commit**: Automatically commit changes after file modifications (with debounce)
- **Manual Commit**: Commands for manual commit and push
- **Auto Push**: Optionally push to remote after commit
- **Custom Template**: Configurable commit message with variables
- **File List**: Optionally include changed file list in commit body
- **i18n**: English and Chinese UI support

## Installation

### Manual Installation

1. Download `main.js` and `manifest.json` from releases
2. Create folder `.obsidian/plugins/auto-git-commit/` in your vault
3. Copy downloaded files into the folder
4. Enable the plugin in Obsidian settings

### Build from Source

```bash
cd .obsidian/plugins/auto-git-commit
npm install
npm run build
```

## Commands

| Command | Description |
|---------|-------------|
| `Auto Git Commit: Commit now` | Commit all changes immediately |
| `Auto Git Commit: Commit and push` | Commit and push to remote |

## Settings

| Option | Description | Default |
|--------|-------------|---------|
| Enable auto commit | Auto commit after file changes | Off |
| Debounce delay (seconds) | Wait time before committing | 30 |
| Auto push after commit | Push to remote after commit | Off |
| Commit message template | Custom message format | `vault backup: {{date}} {{time}}` |
| Include file list in commit body | List changed files in body | Off |
| Git binary path | Path to git executable | `git` |
| Ignore .obsidian directory | Exclude config folder from triggers | On |

## Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{date}}` | ISO date | `2025-12-20` |
| `{{time}}` | Time (HH:MM:SS) | `10:30:00` |
| `{{files}}` | Changed files (max 5) | `a.md, b.md, ...` |
| `{{count}}` | Number of changed files | `3` |

## Example Commit

With "Include file list" enabled:

```
vault backup: 2025-12-20 10:30:00

notes/daily/2025-12-20.md
attachments/image.png
templates/note.md
```

## Requirements

- Obsidian 1.2.0+
- Desktop only (git not available on mobile)
- Git installed and accessible

## License

MIT
