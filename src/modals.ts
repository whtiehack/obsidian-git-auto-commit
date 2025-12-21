import { App, Modal } from "obsidian";
import { t } from "./i18n";

export class RevertConfirmModal extends Modal {
	private files: string[];
	private onConfirm: () => void;

	constructor(app: App, files: string[], onConfirm: () => void) {
		super(app);
		this.files = files;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const i18n = t();
		const { contentEl } = this;

		contentEl.createEl("h2", { text: i18n.revertConfirmTitle });
		contentEl.createEl("p", { text: i18n.revertConfirmDesc });

		const listEl = contentEl.createEl("ul", { cls: "revert-file-list" });
		this.files.forEach((file) => {
			listEl.createEl("li", { text: file });
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
