import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { fetchPageMetadata } from '../openGraph';

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
			const updated = insertLearnMoreEntry(original, {
				title: meta.title,
				url: meta.canonicalUrl,
				description: meta.description
			});
			if (updated === original) {
				notice.hide();
				new Notice('Could not find frontmatter to update.');
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

interface LearnMoreInput {
	title: string;
	url: string;
	description: string;
}

/**
 * Insert a learn-more entry into the file's frontmatter, preserving the
 * rest of the file exactly. Style matches existing posts:
 *   learnMore:
 *     - title: "..."
 *       url: '...'
 *       description: "..."
 */
export function insertLearnMoreEntry(source: string, entry: LearnMoreInput): string {
	const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
	if (!fmMatch) return source;

	const fmStart = fmMatch.index;
	const fmEnd = fmMatch.index + fmMatch[0].length;
	const fmBody = fmMatch[1];

	const newEntryLines = [
		`  - title: ${quoteDouble(entry.title)}`,
		`    url: ${quoteSingle(entry.url)}`,
		`    description: ${quoteDouble(entry.description)}`
	];

	const lines = fmBody.split(/\r?\n/);
	const learnMoreIdx = lines.findIndex((l) => /^learnMore:\s*$/.test(l));

	let nextFmBody: string;
	if (learnMoreIdx === -1) {
		nextFmBody = [...lines, 'learnMore:', ...newEntryLines].join('\n');
	} else {
		// Find end of the learnMore block: next line that is not indented
		// (i.e., back at top-level YAML). We append before that boundary.
		let insertAt = lines.length;
		for (let i = learnMoreIdx + 1; i < lines.length; i++) {
			const l = lines[i];
			if (l.length === 0) continue;
			if (!/^\s/.test(l)) {
				insertAt = i;
				break;
			}
		}
		const before = lines.slice(0, insertAt);
		const after = lines.slice(insertAt);
		nextFmBody = [...before, ...newEntryLines, ...after].join('\n');
	}

	return `${source.slice(0, fmStart)}---\n${nextFmBody}\n---${source.slice(fmEnd)}`;
}

function quoteDouble(s: string): string {
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function quoteSingle(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}
