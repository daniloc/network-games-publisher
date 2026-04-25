import { App, Notice, TFile } from 'obsidian';
import { GitHubClient } from '../github';

export interface PublishContext {
	app: App;
	github: GitHubClient;
	postsPath: string;
}

export async function publishActiveFile(ctx: PublishContext): Promise<void> {
	const file = ctx.app.workspace.getActiveFile();
	if (!file) {
		new Notice('No active file to publish.');
		return;
	}
	if (file.extension !== 'md') {
		new Notice('Active file is not a markdown post.');
		return;
	}

	await publishFile(ctx, file);
}

export async function publishFile(ctx: PublishContext, file: TFile): Promise<void> {
	const remotePath = `${ctx.postsPath}/${file.name}`;
	const local = await ctx.app.vault.read(file);
	const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(local);
	const title = titleMatch ? titleMatch[1].replace(/["']$/, '') : file.basename;

	const notice = new Notice(`Publishing ${file.name}…`, 0);
	try {
		const existing = await ctx.github.getFile(remotePath);
		const verb = existing ? 'update' : 'post';

		if (existing && existing.content === local) {
			notice.hide();
			new Notice('No changes vs. remote — nothing to publish.');
			return;
		}

		const message = `${verb}: ${title}`;
		await ctx.github.putFile(remotePath, local, message, existing?.sha);
		notice.hide();
		new Notice(`Published · ${verb} ${file.name}`);
	} catch (err) {
		notice.hide();
		console.error(err);
		new Notice(`Publish failed: ${(err as Error).message}`);
	}
}
