import { App, TFile } from 'obsidian';
import { readTags } from './frontmatterMutate';

/**
 * Maintains a Set of all tags across post markdown files in the vault.
 * Refreshes lazily on demand and incrementally on file change.
 */
export class TagIndex {
	private counts = new Map<string, number>();
	private filesIndexed = new Map<string, string[]>();
	private dirty = true;

	constructor(private app: App) {}

	registerEvents(onUpdate: () => void): (() => void)[] {
		const cleanups: (() => void)[] = [];
		const refresh = (file: TFile | null) => {
			if (file && file.extension === 'md') {
				void this.indexFile(file).then(onUpdate);
			}
		};
		cleanups.push(this.app.vault.on('modify', (f) => refresh(f as TFile)) as unknown as () => void);
		cleanups.push(this.app.vault.on('create', (f) => refresh(f as TFile)) as unknown as () => void);
		cleanups.push(
			this.app.vault.on('delete', (f) => {
				if (f instanceof TFile) {
					this.removeFile(f.path);
					onUpdate();
				}
			}) as unknown as () => void
		);
		return cleanups;
	}

	async refresh(): Promise<void> {
		this.counts.clear();
		this.filesIndexed.clear();
		const files = this.app.vault.getMarkdownFiles();
		await Promise.all(files.map((f) => this.indexFile(f)));
		this.dirty = false;
	}

	async ensureFresh(): Promise<void> {
		if (this.dirty) await this.refresh();
	}

	private async indexFile(file: TFile): Promise<void> {
		const previous = this.filesIndexed.get(file.path) ?? [];
		for (const tag of previous) this.decrement(tag);

		try {
			const text = await this.app.vault.cachedRead(file);
			const tags = readTags(text);
			this.filesIndexed.set(file.path, tags);
			for (const tag of tags) this.increment(tag);
		} catch {
			this.filesIndexed.set(file.path, []);
		}
	}

	private removeFile(path: string): void {
		const previous = this.filesIndexed.get(path) ?? [];
		for (const tag of previous) this.decrement(tag);
		this.filesIndexed.delete(path);
	}

	private increment(tag: string): void {
		this.counts.set(tag, (this.counts.get(tag) ?? 0) + 1);
	}

	private decrement(tag: string): void {
		const next = (this.counts.get(tag) ?? 0) - 1;
		if (next <= 0) this.counts.delete(tag);
		else this.counts.set(tag, next);
	}

	all(): { tag: string; count: number }[] {
		return [...this.counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	}

	suggestions(query: string, exclude: Set<string>, limit = 8): string[] {
		const q = query.toLowerCase();
		return this.all()
			.filter(({ tag }) => !exclude.has(tag) && tag.toLowerCase().includes(q))
			.slice(0, limit)
			.map(({ tag }) => tag);
	}
}
