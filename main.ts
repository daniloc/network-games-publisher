import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { NewLinkPostModal, openNewFile } from './src/commands/newLinkPost';
import { publishActiveFile } from './src/commands/publish';
import { DeletePostModal } from './src/commands/deletePost';
import { GitHubClient } from './src/github';

interface PublisherSettings {
	githubToken: string;
	githubOwner: string;
	githubRepo: string;
	githubBranch: string;
	postsPath: string;
	redirectsPath: string;
	cloudflareAccountId: string;
	cloudflareToken: string;
	cloudflareProject: string;
	siteUrl: string;
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
	cloudflareProject: 'network-games-svelte',
	siteUrl: 'https://networkgames.fyi'
};

export default class PublisherPlugin extends Plugin {
	settings!: PublisherSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PublisherSettingTab(this.app, this));

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
			id: 'new-link-post',
			name: 'New link post',
			callback: () => {
				new NewLinkPostModal(this.app, (file) => {
					void openNewFile(this.app, file);
				}).open();
			}
		});

		this.addCommand({
			id: 'publish',
			name: 'Publish active post',
			callback: () => {
				const github = this.makeGitHub();
				if (!github) return;
				void publishActiveFile({
					app: this.app,
					github,
					postsPath: this.settings.postsPath
				});
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
			.setDesc('Path to the Cloudflare _redirects file. The plugin updates it silently on rename/delete.')
			.addText((text) =>
				text.setValue(this.plugin.settings.redirectsPath).onChange(async (value) => {
					this.plugin.settings.redirectsPath = value.trim().replace(/^\/+/, '');
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl('h2', { text: 'Cloudflare Pages' });

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
			.setDesc('Token with Cloudflare Pages: Read permission.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setValue(this.plugin.settings.cloudflareToken)
					.onChange(async (value) => {
						this.plugin.settings.cloudflareToken = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Pages project')
			.addText((text) =>
				text.setValue(this.plugin.settings.cloudflareProject).onChange(async (value) => {
					this.plugin.settings.cloudflareProject = value.trim();
					await this.plugin.saveSettings();
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
