import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { GitHubClient } from '../github';
import { addRedirect } from '../redirects';
import { slugify } from '../frontmatter';

export interface RenameContext {
	app: App;
	github: GitHubClient;
	postsPath: string;
	redirectsPath: string;
}

export class RenamePostModal extends Modal {
	private newSlug: string;

	constructor(
		app: App,
		private file: TFile,
		private ctx: RenameContext
	) {
		super(app);
		this.newSlug = file.basename;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: `Rename ${this.file.name}` });
		contentEl.createEl('p', {
			text: 'Renames the file in the vault and the repo, then adds a 301 from the old slug so existing links keep working.',
			cls: 'setting-item-description'
		});

		new Setting(contentEl).setName('New slug').addText((text) => {
			text.setValue(this.newSlug);
			text.inputEl.style.width = '100%';
			text.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					void this.submit();
				}
			});
			text.onChange((v) => (this.newSlug = v.trim()));
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Rename')
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const oldSlug = this.file.basename;
		const normalized = slugify(this.newSlug);
		if (!normalized) {
			new Notice('That slug normalizes to nothing.');
			return;
		}
		if (normalized !== this.newSlug) {
			new Notice(`Using normalized slug: ${normalized}`);
			this.newSlug = normalized;
		}
		if (this.newSlug === oldSlug) {
			new Notice('Same slug — nothing to do.');
			return;
		}

		const newName = `${this.newSlug}.md`;
		if (this.app.vault.getAbstractFileByPath(newName)) {
			new Notice(`A file already exists at ${newName}.`);
			return;
		}

		const oldRemotePath = `${this.ctx.postsPath}/${this.file.name}`;
		const newRemotePath = `${this.ctx.postsPath}/${newName}`;
		const notice = new Notice(`Renaming ${oldSlug} → ${this.newSlug}…`, 0);

		try {
			const oldRemote = await this.ctx.github.getFile(oldRemotePath);

			if (oldRemote) {
				const newRemote = await this.ctx.github.getFile(newRemotePath);
				if (newRemote) {
					notice.hide();
					new Notice(`Remote already has ${newName}. Aborting.`);
					return;
				}

				const local = await this.app.vault.read(this.file);
				await this.ctx.github.putFile(
					newRemotePath,
					local,
					`rename: ${oldSlug} → ${this.newSlug}`
				);
				await this.ctx.github.deleteFile(
					oldRemotePath,
					oldRemote.sha,
					`rename: drop ${oldSlug}`
				);
				await addRedirect(
					{ github: this.ctx.github, redirectsPath: this.ctx.redirectsPath },
					`/${oldSlug}`,
					`/${this.newSlug}`,
					`redirect: /${oldSlug} → /${this.newSlug}`
				);
			}

			await this.app.fileManager.renameFile(this.file, newName);

			notice.hide();
			new Notice(
				oldRemote
					? `Renamed and redirected · ${this.newSlug}`
					: `Renamed local draft · ${this.newSlug}`
			);
			this.close();
		} catch (err) {
			notice.hide();
			console.error(err);
			new Notice(`Rename failed: ${(err as Error).message}`);
		}
	}
}
