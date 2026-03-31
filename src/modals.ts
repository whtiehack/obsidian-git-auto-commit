import { App, Modal } from "obsidian";
import { t } from "./i18n";

export class RevertConfirmModal extends Modal {
	private files: string[];
	private onConfirm: () => void;
	private onDiffRequest: (filePath: string) => void;

	constructor(app: App, files: string[], onConfirm: () => void, onDiffRequest: (filePath: string) => void) {
		super(app);
		this.files = files;
		this.onConfirm = onConfirm;
		this.onDiffRequest = onDiffRequest;
	}

	onOpen() {
		const i18n = t();
		const { contentEl } = this;

		this.setTitle(i18n.revertConfirmTitle);
		contentEl.createEl("p", { text: i18n.revertConfirmDesc });

		const listEl = contentEl.createEl("ul", { cls: "revert-file-list" });
		this.files.forEach((file) => {
			listEl.createEl("li", { text: file + " " })
				.createEl("a", { href: "#", text: i18n.revertViewChanges })
				.addEventListener("click", () => this.onDiffRequest(file));
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		buttonContainer.createEl("button", { text: i18n.revertCancelButton }).addEventListener("click", () => {
			this.close();
		});

		const confirmBtn = buttonContainer.createEl("button", {
			text: i18n.revertConfirmButton,
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class ViewDiffModal extends Modal {
	private title: string;
	private diff: string;

	constructor(app: App, title: string, diff: string) {
		super(app);
		this.title = title;
		this.diff = diff;
	}

	onOpen() {
		this.setTitle(this.title);
		const preview = this.contentEl.createEl("div", { cls: "diff-preview-modal" });
		preview.createEl("pre").setText(this.diff);
		// MarkdownRenderer
		// 	.render(this.app, "```diff\n" + this.diff + "\n```", preview, "", new MarkdownRenderChild(preview));
	}

	onClose() {
		this.contentEl.empty();
	}
}

