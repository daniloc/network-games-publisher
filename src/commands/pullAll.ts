import { App, Modal, Notice, Setting } from 'obsidian';
import { GitHubClient, RemoteDirEntry } from '../github';
import { SyncStateStore } from '../syncState';

export interface PullAllContext {
	app: App;
	github: GitHubClient;
	postsPath: string;
	sync: SyncStateStore;
}

interface Plan {
	entries: RemoteDirEntry[];
	missingLocal: RemoteDirEntry[];
	existsLocal: RemoteDirEntry[];
}

export class PullAllModal extends Modal {
	private plan: Plan | null = null;
	private overwrite = false;

	constructor(private ctx: PullAllContext) {
		super(ctx.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Pull posts from GitHub' });
		const status = contentEl.createDiv({
			text: 'Listing remote posts…',
			cls: 'setting-item-description'
		});
		void this.preparePlan(status);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async preparePlan(statusEl: HTMLElement): Promise<void> {
		try {
			const entries = (await this.ctx.github.listDir(this.ctx.postsPath)).filter(
				(e) => e.type === 'file' && e.name.endsWith('.md')
			);
			const missingLocal: RemoteDirEntry[] = [];
			const existsLocal: RemoteDirEntry[] = [];
			for (const e of entries) {
				if (this.ctx.app.vault.getAbstractFileByPath(e.name)) existsLocal.push(e);
				else missingLocal.push(e);
			}
			this.plan = { entries, missingLocal, existsLocal };
			this.renderPlan(statusEl);
		} catch (err) {
			console.error(err);
			statusEl.setText(`Failed to list remote: ${(err as Error).message}`);
		}
	}

	private renderPlan(replace: HTMLElement): void {
		const { contentEl } = this;
		replace.detach();
		const plan = this.plan!;

		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: `${plan.entries.length} remote · ${plan.missingLocal.length} new · ${plan.existsLocal.length} already in vault`
		});

		new Setting(contentEl)
			.setName('Overwrite existing local files')
			.setDesc(
				'Off (default): only fetch posts that don’t exist in your vault. On: re-fetch every post, replacing local copies. Local-only files are never touched.'
			)
			.addToggle((t) => t.setValue(this.overwrite).onChange((v) => (this.overwrite = v)));

		const buttons = new Setting(contentEl);
		buttons.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText('Pull')
				.setCta()
				.onClick(() => void this.run())
		);
	}

	private async run(): Promise<void> {
		if (!this.plan) return;
		const targets = this.overwrite ? this.plan.entries : this.plan.missingLocal;
		if (targets.length === 0) {
			new Notice('Nothing to pull.');
			this.close();
			return;
		}

		const notice = new Notice(`Pulling 0/${targets.length}…`, 0);
		let pulled = 0;
		let failed = 0;

		for (const entry of targets) {
			try {
				const remote = await this.ctx.github.getFile(`${this.ctx.postsPath}/${entry.name}`);
				if (!remote) {
					failed++;
					continue;
				}
				const existing = this.ctx.app.vault.getAbstractFileByPath(entry.name);
				if (existing && 'extension' in existing) {
					await this.ctx.app.vault.modify(existing as never, remote.content);
				} else {
					await this.ctx.app.vault.create(entry.name, remote.content);
				}
				await this.ctx.sync.set(entry.name, remote.sha);
				pulled++;
				notice.setMessage(`Pulling ${pulled}/${targets.length}…`);
			} catch (err) {
				failed++;
				console.error(`Pull failed for ${entry.name}:`, err);
			}
		}

		notice.hide();
		new Notice(
			failed === 0
				? `Pulled ${pulled} post${pulled === 1 ? '' : 's'}.`
				: `Pulled ${pulled} · ${failed} failed (see console).`
		);
		this.close();
	}
}
