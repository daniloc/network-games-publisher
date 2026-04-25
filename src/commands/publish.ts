import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { GitHubClient } from '../github';
import { SyncStateStore } from '../syncState';

export interface PublishContext {
	app: App;
	github: GitHubClient;
	postsPath: string;
	sync: SyncStateStore;
}

type Resolution = 'overwrite' | 'pull' | 'cancel';

export async function publishActiveFile(ctx: PublishContext): Promise<void> {
	const file = ctx.app.workspace.getActiveFile();
	if (!file) {
		new Notice('No active file to publish.');
		return;
	}
	if (file.extension !== 'md') {
		new Notice('Active file is not a markdown post.');
		return;
	}
	await publishFile(ctx, file);
}

export async function publishFile(ctx: PublishContext, file: TFile): Promise<void> {
	const remotePath = `${ctx.postsPath}/${file.name}`;
	const local = await ctx.app.vault.read(file);
	const title = inferTitle(local) ?? file.basename;

	const notice = new Notice(`Publishing ${file.name}…`, 0);
	try {
		const existing = await ctx.github.getFile(remotePath);
		const verb = existing ? 'update' : 'post';

		if (existing && existing.content === local) {
			await ctx.sync.set(file.name, existing.sha);
			notice.hide();
			new Notice('No changes vs. remote — nothing to publish.');
			return;
		}

		// Conflict check: remote SHA changed since we last synced AND local differs.
		if (existing) {
			const lastKnown = ctx.sync.get(file.name);
			if (lastKnown && lastKnown !== existing.sha) {
				notice.hide();
				const resolution = await openConflictModal(ctx.app, file.name);
				if (resolution === 'cancel') {
					new Notice('Publish canceled.');
					return;
				}
				if (resolution === 'pull') {
					await ctx.app.vault.modify(file, existing.content);
					await ctx.sync.set(file.name, existing.sha);
					new Notice(`Pulled remote into ${file.name}. Re-publish when ready.`);
					return;
				}
				// 'overwrite' falls through — we PUT local with the latest SHA.
				notice.setMessage(`Force-pushing ${file.name}…`);
			}
		}

		const message = `${verb}: ${title}`;
		const newSha = await ctx.github.putFile(remotePath, local, message, existing?.sha);
		await ctx.sync.set(file.name, newSha);
		notice.hide();
		new Notice(`Published · ${verb} ${file.name}`);
	} catch (err) {
		notice.hide();
		console.error(err);
		new Notice(`Publish failed: ${(err as Error).message}`);
	}
}

function inferTitle(content: string): string | null {
	const m = /^title:\s*["']?(.+?)["']?\s*$/m.exec(content);
	return m ? m[1].replace(/["']$/, '') : null;
}

function openConflictModal(app: App, filename: string): Promise<Resolution> {
	return new Promise((resolve) => {
		const modal = new ConflictModal(app, filename, resolve);
		modal.open();
	});
}

class ConflictModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private filename: string,
		private onResolve: (resolution: Resolution) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Remote changed since you last synced' });
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: `${this.filename} was modified on GitHub after the last time the plugin saw it. Your local copy has also diverged. Choose how to proceed:`
		});

		new Setting(contentEl)
			.setName('Pull remote into local')
			.setDesc('Replace your local copy with the remote version. Re-publish from there.')
			.addButton((b) =>
				b.setButtonText('Pull').onClick(() => {
					this.resolveOnce('pull');
				})
			);

		new Setting(contentEl)
			.setName('Overwrite remote with local')
			.setDesc('Force-push your local content. Remote changes will be lost.')
			.addButton((b) =>
				b
					.setButtonText('Overwrite')
					.setWarning()
					.onClick(() => this.resolveOnce('overwrite'))
			);

		new Setting(contentEl).addButton((b) =>
			b.setButtonText('Cancel').onClick(() => this.resolveOnce('cancel'))
		);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.onResolve('cancel');
	}

	private resolveOnce(resolution: Resolution) {
		if (this.resolved) return;
		this.resolved = true;
		this.onResolve(resolution);
		this.close();
	}
}
