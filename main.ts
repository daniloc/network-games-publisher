import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { GitHubClient } from './src/github';
import { CloudflareCoords } from './src/cloudflare';
import { TagIndex } from './src/tagIndex';
import { DeployStatus } from './src/deployStatus';
import { PostView, POST_VIEW_TYPE } from './src/views/postView';
import { NewLinkPostModal, openNewFile } from './src/commands/newLinkPost';
import { NewEssayModal } from './src/commands/newEssay';
import { NewNoteModal } from './src/commands/newNote';
import { AddLearnMoreModal } from './src/commands/addLearnMore';
import { publishActiveFile } from './src/commands/publish';
import { DeletePostModal } from './src/commands/deletePost';
import { RenamePostModal } from './src/commands/renamePost';
import { PullAllModal } from './src/commands/pullAll';
import { createSyncStore, SyncedShas, SyncStateStore } from './src/syncState';

interface PublisherSettings {
	githubToken: string;
	githubOwner: string;
	githubRepo: string;
	githubBranch: string;
	postsPath: string;
	redirectsPath: string;
	cloudflareAccountId: string;
	cloudflareToken: string;
	cloudflareWorkerName: string;
	siteUrl: string;
	syncedShas: SyncedShas;
}

const DEFAULT_SETTINGS: PublisherSettings = {
	githubToken: '',
	githubOwner: 'daniloc',
	githubRepo: 'network-games-svelte',
	githubBranch: 'main',
	postsPath: 'src/lib/posts',
	redirectsPath: 'static/_redirects',
	cloudflareAccountId: '',
	cloudflareToken: '',
	cloudflareWorkerName: 'network-games',
	siteUrl: 'https://networkgames.fyi',
	syncedShas: {}
};

export default class PublisherPlugin extends Plugin {
	settings!: PublisherSettings;
	tagIndex!: TagIndex;
	deployStatus: DeployStatus | null = null;
	sync!: SyncStateStore;

	async onload() {
		await this.loadSettings();

		this.sync = createSyncStore(
			() => this.settings.syncedShas,
			async (next) => {
				this.settings.syncedShas = next;
				await this.saveSettings();
			}
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) void this.sync.remove(file.name);
			})
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					const oldName = oldPath.split('/').pop();
					if (oldName) void this.sync.remove(oldName);
				}
			})
		);

		this.tagIndex = new TagIndex(this.app);
		this.app.workspace.onLayoutReady(() => void this.tagIndex.refresh());
		const cleanups = this.tagIndex.registerEvents(() => {
			/* future: notify open views */
		});
		cleanups.forEach((c) => this.register(c));

		this.registerView(POST_VIEW_TYPE, (leaf) => new PostView(leaf, { tagIndex: this.tagIndex }));

		const statusBarEl = this.addStatusBarItem();
		this.deployStatus = new DeployStatus({
			statusBarEl,
			getCoords: () => this.cloudflareCoords(),
			getSiteUrl: () => this.settings.siteUrl,
			openExternal: (url) => window.open(url, '_blank')
		});
		this.app.workspace.onLayoutReady(() => void this.deployStatus?.refresh());

		this.addSettingTab(new PublisherSettingTab(this.app, this));
		this.registerCommands();
	}

	async onunload() {
		this.deployStatus?.dispose();
		this.deployStatus = null;
	}

	private registerCommands() {
		this.addCommand({
			id: 'publisher-ping',
			name: 'Publisher: ping (sanity check)',
			callback: () => {
				const ok = Boolean(this.settings.githubToken);
				new Notice(
					ok
						? `Publisher ready · ${this.settings.githubOwner}/${this.settings.githubRepo}@${this.settings.githubBranch}`
						: 'Publisher: GitHub token not set. Open Settings → Network Games Publisher.'
				);
			}
		});

		this.addCommand({
			id: 'new-essay',
			name: 'New essay',
			callback: () => {
				new NewEssayModal(this.app, (file) => void openNewFile(this.app, file)).open();
			}
		});

		this.addCommand({
			id: 'new-link-post',
			name: 'New link post',
			callback: () => {
				new NewLinkPostModal(this.app, (file) => void openNewFile(this.app, file)).open();
			}
		});

		this.addCommand({
			id: 'new-note',
			name: 'New note from Bluesky',
			callback: () => {
				new NewNoteModal(this.app, (file) => void openNewFile(this.app, file)).open();
			}
		});

		this.addCommand({
			id: 'add-learn-more',
			name: 'Add learn more entry',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (checking) return true;
				new AddLearnMoreModal(this.app, file).open();
				return true;
			}
		});

		this.addCommand({
			id: 'publish',
			name: 'Publish active post',
			callback: async () => {
				const github = this.makeGitHub();
				if (!github) return;
				await publishActiveFile({
					app: this.app,
					github,
					postsPath: this.settings.postsPath,
					sync: this.sync
				});
				void this.deployStatus?.beginPolling();
			}
		});

		this.addCommand({
			id: 'pull-all',
			name: 'Pull all posts from GitHub',
			callback: () => {
				const github = this.makeGitHub();
				if (!github) return;
				new PullAllModal({
					app: this.app,
					github,
					postsPath: this.settings.postsPath,
					sync: this.sync
				}).open();
			}
		});

		this.addCommand({
			id: 'rename-post',
			name: 'Rename active post (with redirect)',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (checking) return true;
				const github = this.makeGitHub();
				if (!github) return true;
				new RenamePostModal(this.app, file, {
					app: this.app,
					github,
					postsPath: this.settings.postsPath,
					redirectsPath: this.settings.redirectsPath
				}).open();
				return true;
			}
		});

		this.addCommand({
			id: 'delete-post',
			name: 'Delete active post',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (checking) return true;
				const github = this.makeGitHub();
				if (!github) return true;
				new DeletePostModal(this.app, file, {
					app: this.app,
					github,
					postsPath: this.settings.postsPath,
					redirectsPath: this.settings.redirectsPath
				}).open();
				return true;
			}
		});

		this.addCommand({
			id: 'open-post-inspector',
			name: 'Open post inspector',
			callback: () => void this.openPostInspector()
		});
	}

	private async openPostInspector(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(POST_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null = existing[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: POST_VIEW_TYPE, active: true });
		}
		if (leaf) this.app.workspace.revealLeaf(leaf);
	}

	private makeGitHub(): GitHubClient | null {
		const { githubToken, githubOwner, githubRepo, githubBranch } = this.settings;
		if (!githubToken || !githubOwner || !githubRepo || !githubBranch) {
			new Notice('Publisher: GitHub coords not set. Open Settings → Network Games Publisher.');
			return null;
		}
		return new GitHubClient({
			token: githubToken,
			owner: githubOwner,
			repo: githubRepo,
			branch: githubBranch
		});
	}

	private cloudflareCoords(): CloudflareCoords | null {
		const { cloudflareAccountId, cloudflareToken, cloudflareWorkerName } = this.settings;
		if (!cloudflareAccountId || !cloudflareToken || !cloudflareWorkerName) return null;
		return {
			accountId: cloudflareAccountId,
			token: cloudflareToken,
			workerName: cloudflareWorkerName
		};
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PublisherSettingTab extends PluginSettingTab {
	plugin: PublisherPlugin;

	constructor(app: App, plugin: PublisherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'GitHub' });

		new Setting(containerEl)
			.setName('Personal access token')
			.setDesc(
				'Fine-grained PAT scoped to the blog repo with Contents: Read & Write. Stored locally via Obsidian.'
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('github_pat_…')
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Repo owner')
			.addText((text) =>
				text.setValue(this.plugin.settings.githubOwner).onChange(async (value) => {
					this.plugin.settings.githubOwner = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Repo name')
			.addText((text) =>
				text.setValue(this.plugin.settings.githubRepo).onChange(async (value) => {
					this.plugin.settings.githubRepo = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Branch')
			.addText((text) =>
				text.setValue(this.plugin.settings.githubBranch).onChange(async (value) => {
					this.plugin.settings.githubBranch = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Posts path')
			.setDesc('Path to the posts directory in the repo.')
			.addText((text) =>
				text.setValue(this.plugin.settings.postsPath).onChange(async (value) => {
					this.plugin.settings.postsPath = value.trim().replace(/^\/+|\/+$/g, '');
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Redirects path')
			.setDesc(
				'Path to the Cloudflare _redirects file. The plugin updates it silently on rename/delete.'
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.redirectsPath).onChange(async (value) => {
					this.plugin.settings.redirectsPath = value.trim().replace(/^\/+/, '');
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl('h2', { text: 'Cloudflare Workers Builds' });

		new Setting(containerEl)
			.setName('Account ID')
			.setDesc('From the Cloudflare dashboard sidebar.')
			.addText((text) =>
				text.setValue(this.plugin.settings.cloudflareAccountId).onChange(async (value) => {
					this.plugin.settings.cloudflareAccountId = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('API token')
			.setDesc(
				'User-scoped token (cfut_…) with Workers Scripts: Read AND Workers Builds: Edit. Account-scoped tokens (cfat_…) cannot reach the Builds API.'
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setValue(this.plugin.settings.cloudflareToken).onChange(async (value) => {
					this.plugin.settings.cloudflareToken = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Worker name')
			.setDesc('The Workers script name (not the tag UUID). Plugin resolves the tag automatically.')
			.addText((text) =>
				text
					.setPlaceholder('e.g. network-games')
					.setValue(this.plugin.settings.cloudflareWorkerName)
					.onChange(async (value) => {
						this.plugin.settings.cloudflareWorkerName = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).addButton((b) =>
			b.setButtonText('Refresh deploy status').onClick(() => {
				void this.plugin.deployStatus?.refresh();
			})
		);

		containerEl.createEl('h2', { text: 'Site' });

		new Setting(containerEl)
			.setName('Live site URL')
			.setDesc('Used to build "Open in browser" links once a post is deployed.')
			.addText((text) =>
				text.setValue(this.plugin.settings.siteUrl).onChange(async (value) => {
					this.plugin.settings.siteUrl = value.trim().replace(/\/+$/, '');
					await this.plugin.saveSettings();
				})
			);
	}
}
