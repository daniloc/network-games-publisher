import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { fetchPageMetadata } from '../openGraph';
import { readLearnMore, setLearnMore } from '../frontmatterMutate';

export class AddLearnMoreModal extends Modal {
	private url = '';

	constructor(app: App, private file: TFile) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Add learn more entry' });
		contentEl.createEl('p', {
			text: `Paste a URL — its og:title, og:description and canonical link become a new entry in this post's learnMore array.`,
			cls: 'setting-item-description'
		});

		new Setting(contentEl).setName('URL').addText((text) => {
			text.setPlaceholder('https://example.com/article');
			text.inputEl.style.width = '100%';
			text.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					void this.submit();
				}
			});
			text.onChange((v) => (this.url = v.trim()));
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Add entry')
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.url) {
			new Notice('Paste a URL first.');
			return;
		}
		const notice = new Notice('Fetching metadata…', 0);
		try {
			const meta = await fetchPageMetadata(this.url);
			const original = await this.app.vault.read(this.file);
			const existing = readLearnMore(original);
			const updated = setLearnMore(original, [
				...existing,
				{ title: meta.title, url: meta.canonicalUrl, description: meta.description }
			]);
			if (updated === original) {
				notice.hide();
				new Notice('Could not update frontmatter.');
				return;
			}
			await this.app.vault.modify(this.file, updated);
			notice.hide();
			new Notice('Added to learnMore.');
			this.close();
		} catch (err) {
			notice.hide();
			console.error(err);
			new Notice(`Failed: ${(err as Error).message}`);
		}
	}
}
