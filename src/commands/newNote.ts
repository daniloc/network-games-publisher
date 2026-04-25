import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { fetchBlueskyThread } from '../bluesky';
import { buildFrontmatter, slugify, todayISO, NoteMeta } from '../frontmatter';

export class NewNoteModal extends Modal {
	private url = '';

	constructor(app: App, private onCreate: (file: TFile) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'New note from Bluesky' });
		contentEl.createEl('p', {
			text: 'Paste a Bluesky post URL. The plugin pulls the thread (same-author replies in order), restores embedded links, and creates a note draft.',
			cls: 'setting-item-description'
		});

		new Setting(contentEl).setName('Bluesky URL').addText((text) => {
			text.setPlaceholder('https://bsky.app/profile/handle/post/…');
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
				.setButtonText('Create note')
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.url) {
			new Notice('Paste a Bluesky URL first.');
			return;
		}

		const notice = new Notice('Fetching Bluesky thread…', 0);
		try {
			const thread = await fetchBlueskyThread(this.url);
			const first = thread.posts[0];
			const titleLine = first.text.split('\n')[0].slice(0, 100);
			const title = titleLine.length < first.text.split('\n')[0].length ? `${titleLine}…` : titleLine;
			const body = thread.posts
				.map((p) => `${p.text}${p.embedMarkdown}`.trim())
				.join('\n\n');
			const excerpt = body.replace(/\s+/g, ' ').slice(0, 200).trim() + '…';
			const slug = await this.uniqueSlug(slugify(first.text, 50));
			const date = first.createdAt.split('T')[0];

			const meta: NoteMeta = {
				title,
				date,
				excerpt,
				type: 'note',
				source: thread.rootUrl,
				tags: ['Bluesky']
			};

			const file = await this.app.vault.create(`${slug}.md`, buildFrontmatter(meta, body));
			notice.hide();
			new Notice(`Note created · ${slug}.md`);
			this.close();
			this.onCreate(file);
		} catch (err) {
			notice.hide();
			console.error(err);
			new Notice(`Failed: ${(err as Error).message}`);
		}
	}

	private async uniqueSlug(base: string): Promise<string> {
		if (!base) base = `note-${todayISO()}`;
		let candidate = base;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${candidate}.md`)) {
			candidate = `${base}-${n++}`;
		}
		return candidate;
	}
}
