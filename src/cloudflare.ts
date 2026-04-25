import { requestUrl } from 'obsidian';

/**
 * Cloudflare Workers Builds (git-integrated CI for Workers).
 *
 * Endpoint:  GET /accounts/{account_id}/builds/workers/{worker_tag}/builds
 * Token:     User-scoped (cfut_...) with:
 *              - Account · Workers Scripts · Read   (resolve tag from name)
 *              - Account · Workers Builds (Edit)    (query builds)
 *
 * Account-scoped tokens (cfat_...) cannot reach the Builds API regardless
 * of permissions — Cloudflare returns 12006 ("Invalid token") for them.
 *
 * The user provides a worker NAME (e.g. "network-games"); the client looks
 * up the tag UUID once via /workers/scripts/{name} and caches it for the
 * session.
 */

export interface CloudflareCoords {
	accountId: string;
	token: string;
	workerName: string;
}

export interface DeploymentSummary {
	id: string;
	shortId: string;
	createdOn: string;
	stageName: string;
	stageStatus: 'queued' | 'building' | 'success' | 'failure' | 'canceled' | 'unknown';
	branch: string;
	commitMessage: string;
	commitHash: string;
}

interface RawBuild {
	build_uuid?: string;
	status?: string;
	build_outcome?: string | null;
	created_on?: string;
	build_trigger_metadata?: {
		branch?: string;
		commit_hash?: string;
		commit_message?: string;
	};
}

interface RawScript {
	id: string;
	tag: string;
}

export class CloudflareClient {
	private cachedTag: string | null = null;

	constructor(private coords: CloudflareCoords) {}

	async latestDeployment(): Promise<DeploymentSummary | null> {
		const tag = await this.workerTag();
		const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.coords.accountId)}/builds/workers/${encodeURIComponent(tag)}/builds?per_page=1`;
		const { status, body } = await this.fetchJson(url);
		if (status >= 400) {
			throw new Error(`Workers Builds → ${status}: ${this.errorMessage(body)}`);
		}
		const result = (body as { result?: RawBuild[] } | null)?.result;
		const first = result?.[0];
		return first ? summarize(first) : null;
	}

	private async workerTag(): Promise<string> {
		if (this.cachedTag) return this.cachedTag;
		// /workers/scripts/{name} returns the script source (204 for assets-only
		// workers). The metadata + tag live on the list endpoint instead.
		const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.coords.accountId)}/workers/scripts`;
		const { status, body } = await this.fetchJson(url);
		if (status >= 400) {
			throw new Error(`Worker list → ${status}: ${this.errorMessage(body)}`);
		}
		const scripts = (body as { result?: RawScript[] } | null)?.result ?? [];
		const match = scripts.find((s) => s.id === this.coords.workerName);
		if (!match) {
			throw new Error(
				`Worker "${this.coords.workerName}" not found in account (${scripts.length} scripts visible)`
			);
		}
		this.cachedTag = match.tag;
		return match.tag;
	}

	private async fetchJson(url: string): Promise<{ status: number; body: unknown; text: string }> {
		const res = await requestUrl({
			url,
			method: 'GET',
			headers: this.headers(),
			throw: false
		});
		const text = res.text ?? '';
		let body: unknown = null;
		if (text.trim().length > 0) {
			try {
				body = JSON.parse(text);
			} catch {
				body = null;
			}
		}
		return { status: res.status, body, text };
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.coords.token}`,
			'Content-Type': 'application/json'
		};
	}

	private errorMessage(body: unknown): string {
		const errs = (body as { errors?: { message?: string }[] } | null)?.errors;
		const joined = errs?.map((e) => e.message).filter(Boolean).join(', ');
		return joined && joined.length > 0 ? joined : 'no error body';
	}
}

function summarize(b: RawBuild): DeploymentSummary {
	const id = b.build_uuid ?? '';
	const meta = b.build_trigger_metadata ?? {};
	return {
		id,
		shortId: id ? id.slice(0, 7) : '—',
		createdOn: b.created_on ?? '',
		stageName: stageLabel(b),
		stageStatus: normalizeStatus(b),
		branch: meta.branch ?? '',
		commitMessage: meta.commit_message ?? '',
		commitHash: meta.commit_hash?.slice(0, 7) ?? ''
	};
}

function stageLabel(b: RawBuild): string {
	const s = (b.status ?? '').toLowerCase();
	if (s === 'stopped') {
		return (b.build_outcome ?? 'stopped').toLowerCase();
	}
	return s || 'unknown';
}

function normalizeStatus(b: RawBuild): DeploymentSummary['stageStatus'] {
	const s = (b.status ?? '').toLowerCase();
	const outcome = (b.build_outcome ?? '').toLowerCase();
	if (s === 'stopped') {
		if (outcome === 'success' || outcome === 'succeeded') return 'success';
		if (outcome === 'fail' || outcome === 'failed' || outcome === 'failure') return 'failure';
		if (outcome === 'cancelled' || outcome === 'canceled') return 'canceled';
		return 'unknown';
	}
	switch (s) {
		case 'queued':
		case 'pending':
			return 'queued';
		case 'initializing':
		case 'building':
		case 'running':
		case 'in_progress':
		case 'active':
			return 'building';
		default:
			return 'unknown';
	}
}

export function isTerminal(d: DeploymentSummary): boolean {
	return d.stageStatus === 'success' || d.stageStatus === 'failure' || d.stageStatus === 'canceled';
}
