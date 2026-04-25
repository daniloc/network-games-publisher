import { requestUrl, RequestUrlResponse } from 'obsidian';

export interface RemoteFile {
	content: string;
	sha: string;
}

export interface RemoteDirEntry {
	name: string;
	path: string;
	type: 'file' | 'dir';
	sha: string;
}

export interface GitHubCoords {
	token: string;
	owner: string;
	repo: string;
	branch: string;
}

export class GitHubClient {
	constructor(private coords: GitHubCoords) {}

	private url(path: string): string {
		const safePath = path.split('/').map(encodeURIComponent).join('/');
		return `https://api.github.com/repos/${this.coords.owner}/${this.coords.repo}/contents/${safePath}`;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.coords.token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		};
	}

	async getFile(path: string): Promise<RemoteFile | null> {
		const res = await this.request('GET', `${this.url(path)}?ref=${encodeURIComponent(this.coords.branch)}`);
		if (res.status === 404) return null;
		this.assertOk(res, `getFile ${path}`);
		const body = res.json as { content: string; sha: string; encoding: string };
		if (body.encoding !== 'base64') {
			throw new Error(`Unexpected encoding for ${path}: ${body.encoding}`);
		}
		return { content: base64ToUtf8(body.content), sha: body.sha };
	}

	async putFile(path: string, content: string, message: string, sha?: string): Promise<string> {
		const res = await this.request('PUT', this.url(path), {
			message,
			content: utf8ToBase64(content),
			branch: this.coords.branch,
			...(sha ? { sha } : {})
		});
		this.assertOk(res, `putFile ${path}`);
		const body = res.json as { content: { sha: string } };
		return body.content.sha;
	}

	async deleteFile(path: string, sha: string, message: string): Promise<void> {
		const res = await this.request('DELETE', this.url(path), {
			message,
			sha,
			branch: this.coords.branch
		});
		this.assertOk(res, `deleteFile ${path}`);
	}

	async listDir(path: string): Promise<RemoteDirEntry[]> {
		const res = await this.request('GET', `${this.url(path)}?ref=${encodeURIComponent(this.coords.branch)}`);
		if (res.status === 404) return [];
		this.assertOk(res, `listDir ${path}`);
		const body = res.json as RemoteDirEntry[];
		return Array.isArray(body) ? body : [];
	}

	private async request(
		method: string,
		url: string,
		body?: unknown
	): Promise<RequestUrlResponse> {
		return requestUrl({
			url,
			method,
			headers: {
				...this.headers(),
				...(body ? { 'Content-Type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined,
			throw: false
		});
	}

	private assertOk(res: RequestUrlResponse, ctx: string): void {
		if (res.status >= 200 && res.status < 300) return;
		const detail = (res.json as { message?: string } | null)?.message ?? res.text ?? '';
		throw new Error(`GitHub ${ctx} → ${res.status}: ${detail}`);
	}
}

function utf8ToBase64(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function base64ToUtf8(b64: string): string {
	const binary = atob(b64.replace(/\s/g, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}
