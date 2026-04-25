import { ItemView, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { TagIndex } from '../tagIndex';
import {
	detectPostType,
	readField,
	readTags,
	setField,
	setTags
} from '../frontmatterMutate';

export const POST_VIEW_TYPE = 'network-games-post-view';

interface ViewDeps {
	tagIndex: TagIndex;
}

export class PostView extends ItemView {
	private currentFile: TFile | null = null;
	private currentText = '';
	private formContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private deps: ViewDeps) {
		super(leaf);
	}

	getViewType(): string {
		return POST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Post inspector';
	}

	getIcon(): string {
		return 'file-text';
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		root.empty();
		root.addClass('publisher-post-view');

		this.formContainer = root.createDiv();
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => void this.bindActive())
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file === this.currentFile) {
					void this.bindActive();
				}
			})
		);
		await this.bindActive();
	}

	async onClose(): Promise<void> {
		this.formContainer = null;
	}

	private async bindActive(): Promise<void> {
		if (!this.formContainer) return;
		const active = this.app.workspace.getActiveFile();
		if (!active || active.extension !== 'md') {
			this.currentFile = null;
			this.currentText = '';
			this.renderEmpty();
			return;
		}
		this.currentFile = active;
		this.currentText = await this.app.vault.read(active);
		this.render();
	}

	private renderEmpty(): void {
		const c = this.formContainer!;
		c.empty();
		c.createEl('div', {
			text: 'Open a markdown post to inspect its frontmatter.',
			cls: 'setting-item-description'
		});
	}

	private render(): void {
		const c = this.formContainer!;
		c.empty();

		const type = detectPostType(this.currentText);
		c.createEl('div', { text: this.currentFile!.basename, cls: 'publisher-post-view-slug' });
		c.createEl('div', {
			text: type.toUpperCase(),
			cls: 'publisher-post-view-type'
		});

		this.scalarSetting(c, 'Title', 'title');
		this.scalarSetting(c, 'Date', 'date', 'date');
		this.scalarSetting(c, 'Updated', 'updated', 'date');
		this.scalarSetting(c, 'Excerpt', 'excerpt', 'text', true);

		if (type === 'link') {
			this.scalarSetting(c, 'Link URL', 'link');
		}
		if (type === 'note') {
			this.scalarSetting(c, 'Source URL', 'source');
		}

		this.tagsEditor(c);
	}

	private scalarSetting(
		container: HTMLElement,
		label: string,
		key: string,
		inputType: 'text' | 'date' = 'text',
		wide = false
	): void {
		const current = readField(this.currentText, key) ?? '';
		const setting = new Setting(container).setName(label);
		setting.addText((text) => {
			text.inputEl.type = inputType;
			text.inputEl.style.width = wide ? '100%' : '';
			text.setValue(current);
			text.onChange(async (value) => {
				if (!this.currentFile) return;
				const next = setField(this.currentText, key, value);
				if (next === this.currentText) return;
				this.currentText = next;
				await this.app.vault.modify(this.currentFile, next);
			});
		});
	}

	private tagsEditor(container: HTMLElement): void {
		const heading = container.createDiv({ cls: 'setting-item-name' });
		heading.setText('Tags');

		const wrapper = container.createDiv({ cls: 'publisher-tag-editor' });
		const chips = wrapper.createDiv({ cls: 'publisher-tag-chips' });
		const inputRow = wrapper.createDiv({ cls: 'publisher-tag-input-row' });
		const input = inputRow.createEl('input', {
			type: 'text',
			placeholder: 'Add tag…',
			cls: 'publisher-tag-input'
		});
		const suggestions = wrapper.createDiv({ cls: 'publisher-tag-suggestions' });

		const renderChips = () => {
			chips.empty();
			const tags = readTags(this.currentText);
			tags.forEach((tag) => {
				const chip = chips.createDiv({ cls: 'publisher-tag-chip' });
				chip.createSpan({ text: tag });
				const removeBtn = chip.createEl('button', { text: '×', cls: 'publisher-tag-remove' });
				removeBtn.addEventListener('click', async () => {
					const next = setTags(
						this.currentText,
						tags.filter((t) => t !== tag)
					);
					await this.commit(next);
					renderChips();
					renderSuggestions(input.value);
				});
			});
		};

		const renderSuggestions = async (query: string) => {
			suggestions.empty();
			if (!query.trim()) return;
			await this.deps.tagIndex.ensureFresh();
			const current = new Set(readTags(this.currentText));
			const matches = this.deps.tagIndex.suggestions(query, current);
			matches.forEach((tag) => {
				const item = suggestions.createDiv({ cls: 'publisher-tag-suggestion', text: tag });
				item.addEventListener('click', () => {
					addTag(tag);
				});
			});
		};

		const addTag = async (raw: string) => {
			const tag = raw.trim();
			if (!tag) return;
			const tags = readTags(this.currentText);
			if (tags.includes(tag)) {
				input.value = '';
				renderSuggestions('');
				return;
			}
			const next = setTags(this.currentText, [...tags, tag]);
			await this.commit(next);
			input.value = '';
			renderChips();
			renderSuggestions('');
		};

		input.addEventListener('input', () => void renderSuggestions(input.value));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void addTag(input.value);
			}
		});

		renderChips();
	}

	private async commit(next: string): Promise<void> {
		if (!this.currentFile || next === this.currentText) return;
		this.currentText = next;
		await this.app.vault.modify(this.currentFile, next);
	}
}
