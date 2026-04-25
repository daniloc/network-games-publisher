import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { GitHubClient } from '../github';
import { addRedirect } from '../redirects';

export interface DeleteContext {
	app: App;
	github: GitHubClient;
	postsPath: string;
	redirectsPath: string;
}

export class DeletePostModal extends Modal {
	private redirectTo = '';

	constructor(
		app: App,
		private file: TFile,
		private ctx: DeleteContext
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: `Delete ${this.file.name}?` });
		contentEl.createEl('p', {
			text: 'Removes the post from the live site (if published) and from your vault. Cannot be undone here — recover from git history if needed.',
			cls: 'setting-item-description'
		});

		new Setting(contentEl)
			.setName('Redirect (optional)')
			.setDesc('A path or URL to redirect the old slug to. Leave blank to let the URL 404.')
			.addText((text) => {
				text.setPlaceholder('/some-other-post  or  https://…');
				text.inputEl.style.width = '100%';
				text.onChange((v) => (this.redirectTo = v.trim()));
			});

		const buttons = new Setting(contentEl);
		buttons.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText('Delete')
				.setWarning()
				.onClick(() => void this.submit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const remotePath = `${this.ctx.postsPath}/${this.file.name}`;
		const slug = this.file.basename;
		const notice = new Notice(`Deleting ${this.file.name}…`, 0);

		try {
			const remote = await this.ctx.github.getFile(remotePath);
			let pushedRedirect = false;

			if (remote) {
				await this.ctx.github.deleteFile(remotePath, remote.sha, `delete: ${slug}`);

				if (this.redirectTo) {
					await addRedirect(
						{ github: this.ctx.github, redirectsPath: this.ctx.redirectsPath },
						`/${slug}`,
						this.redirectTo,
						`redirect: /${slug} → ${this.redirectTo}`
					);
					pushedRedirect = true;
				}
			}

			await this.app.vault.delete(this.file);
			notice.hide();

			if (remote && pushedRedirect) {
				new Notice(`Deleted ${this.file.name} · redirect added`);
			} else if (remote) {
				new Notice(`Deleted ${this.file.name} from repo and vault`);
			} else {
				new Notice(`Deleted local draft ${this.file.name}`);
			}
			this.close();
		} catch (err) {
			notice.hide();
			console.error(err);
			new Notice(`Delete failed: ${(err as Error).message}`);
		}
	}
}
