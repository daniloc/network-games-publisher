import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { buildFrontmatter, slugify, todayISO, EssayMeta } from '../frontmatter';

export class NewEssayModal extends Modal {
	private title = '';
	private excerpt = '';

	constructor(app: App, private onCreate: (file: TFile) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'New essay' });

		new Setting(contentEl).setName('Title').addText((text) => {
			text.setPlaceholder('A piece of work');
			text.inputEl.style.width = '100%';
			text.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					void this.submit();
				}
			});
			text.onChange((v) => (this.title = v.trim()));
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl)
			.setName('Excerpt')
			.setDesc('Optional. You can fill it in later in the file.')
			.addText((text) => {
				text.inputEl.style.width = '100%';
				text.onChange((v) => (this.excerpt = v.trim()));
			});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Create draft')
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.title) {
			new Notice('Give the essay a title first.');
			return;
		}
		const slug = await this.uniqueSlug(slugify(this.title));
		const meta: EssayMeta = {
			title: this.title,
			date: todayISO(),
			excerpt: this.excerpt,
			tags: []
		};
		try {
			const file = await this.app.vault.create(`${slug}.md`, buildFrontmatter(meta, ''));
			new Notice(`Draft created · ${slug}.md`);
			this.close();
			this.onCreate(file);
		} catch (err) {
			console.error(err);
			new Notice(`Failed: ${(err as Error).message}`);
		}
	}

	private async uniqueSlug(base: string): Promise<string> {
		if (!base) base = `essay-${todayISO()}`;
		let candidate = base;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${candidate}.md`)) {
			candidate = `${base}-${n++}`;
		}
		return candidate;
	}
}
