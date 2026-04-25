import { App, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import { fetchPageMetadata } from '../openGraph';
import { buildFrontmatter, slugify, todayISO, LinkPostMeta } from '../frontmatter';

export class NewLinkPostModal extends Modal {
	private url = '';

	constructor(app: App, private onCreate: (file: TFile) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'New link post' });
		contentEl.createEl('p', {
			text: 'Paste a URL. The plugin fetches its metadata, builds a draft, and opens it for your commentary.',
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
				.setButtonText('Create draft')
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

		let parsed: URL;
		try {
			parsed = new URL(this.url);
		} catch {
			new Notice('That doesn’t look like a URL.');
			return;
		}

		const notice = new Notice(`Fetching ${parsed.hostname}…`, 0);
		try {
			const meta = await fetchPageMetadata(this.url);
			const slug = await this.uniqueSlug(slugify(meta.title));
			const frontmatter: LinkPostMeta = {
				title: meta.title,
				date: todayISO(),
				excerpt: meta.description,
				link: meta.canonicalUrl,
				tags: []
			};
			const body = '';
			const file = await this.app.vault.create(
				`${slug}.md`,
				buildFrontmatter(frontmatter, body)
			);
			notice.hide();
			new Notice(`Draft created · ${slug}.md`);
			this.close();
			this.onCreate(file);
		} catch (err) {
			notice.hide();
			console.error(err);
			new Notice(`Failed: ${(err as Error).message}`);
		}
	}

	private async uniqueSlug(base: string): Promise<string> {
		if (!base) base = `link-${todayISO()}`;
		let candidate = base;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${candidate}.md`)) {
			candidate = `${base}-${n++}`;
		}
		return candidate;
	}
}

export async function openNewFile(app: App, file: TFile): Promise<void> {
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file);
}

// satisfy lint: TFolder import is reserved for future "drafts" subfolder support
void TFolder;
