import { Notice } from "obsidian";

/** Notice with loading spinner that transitions to success/fail state */
export class ProgressNotice {
	private notice: Notice;

	constructor(message: string) {
		this.notice = new Notice(message, 0);
		this.notice.messageEl.parentElement?.addClass("is-loading");
	}

	succeed(message: string, timeout = 3000) {
		const el = this.notice.messageEl.parentElement;
		el?.removeClass("is-loading");
		el?.addClass("mod-success");
		this.notice.setMessage(message);
		window.setTimeout(() => this.notice.hide(), timeout);
	}

	fail(message: string, timeout = 5000) {
		this.notice.messageEl.parentElement?.removeClass("is-loading");
		this.notice.setMessage(message);
		window.setTimeout(() => this.notice.hide(), timeout);
	}
}
