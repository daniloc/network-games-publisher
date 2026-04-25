import { CloudflareClient, CloudflareCoords, DeploymentSummary, isTerminal } from './cloudflare';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface DeployStatusDeps {
	statusBarEl: HTMLElement;
	getCoords: () => CloudflareCoords | null;
	getSiteUrl: () => string;
	openExternal: (url: string) => void;
}

type DisplayState =
	| { kind: 'unset' }
	| { kind: 'idle'; latest: DeploymentSummary | null; lastUpdated: number }
	| { kind: 'polling'; startedAt: number; latest: DeploymentSummary | null }
	| { kind: 'error'; message: string };

export class DeployStatus {
	private state: DisplayState = { kind: 'unset' };
	private pollTimer: number | null = null;
	private tickTimer: number | null = null;
	private lastSeenDeploymentId: string | null = null;

	constructor(private deps: DeployStatusDeps) {
		this.deps.statusBarEl.addClass('publisher-deploy-status');
		this.deps.statusBarEl.style.cursor = 'pointer';
		this.deps.statusBarEl.addEventListener('click', () => {
			this.openTarget();
		});
		this.render();
	}

	dispose(): void {
		if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
		if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
	}

	/** Fire after a publish to start watching for the resulting deploy. */
	async beginPolling(): Promise<void> {
		const client = this.client();
		if (!client) {
			this.state = { kind: 'unset' };
			this.render();
			return;
		}

		this.state = { kind: 'polling', startedAt: Date.now(), latest: null };
		this.render();
		this.startTickTimer();

		try {
			const initial = await client.latestDeployment();
			this.lastSeenDeploymentId = initial?.id ?? null;
		} catch {
			// Will be retried by the poll loop.
		}

		this.startPollTimer(client, true);
	}

	/** Refresh the current state once (no polling). Use on load and on demand. */
	async refresh(): Promise<void> {
		const client = this.client();
		if (!client) {
			this.state = { kind: 'unset' };
			this.render();
			return;
		}
		try {
			const latest = await client.latestDeployment();
			this.state = { kind: 'idle', latest, lastUpdated: Date.now() };
			this.render();
		} catch (err) {
			this.state = { kind: 'error', message: (err as Error).message };
			this.render();
		}
	}

	private client(): CloudflareClient | null {
		const coords = this.deps.getCoords();
		if (!coords) return null;
		return new CloudflareClient(coords);
	}

	private startPollTimer(client: CloudflareClient, watchForNew: boolean): void {
		this.stopPollTimer();
		this.pollTimer = window.setInterval(async () => {
			if (this.state.kind === 'polling' && Date.now() - this.state.startedAt > POLL_TIMEOUT_MS) {
				this.stopPollTimer();
				this.stopTickTimer();
				this.state = { kind: 'error', message: 'deploy poll timed out' };
				this.render();
				return;
			}
			try {
				const latest = await client.latestDeployment();
				if (this.state.kind !== 'polling') return;
				this.state.latest = latest;

				if (watchForNew && latest && latest.id !== this.lastSeenDeploymentId) {
					// A new deployment showed up — that's the one to watch.
					this.lastSeenDeploymentId = latest.id;
				}

				if (latest && latest.id === this.lastSeenDeploymentId && isTerminal(latest)) {
					this.stopPollTimer();
					this.stopTickTimer();
					this.state = { kind: 'idle', latest, lastUpdated: Date.now() };
				}
				this.render();
			} catch (err) {
				if (this.state.kind === 'polling') this.state.latest = null;
				this.render();
				console.error('Deploy poll error:', err);
			}
		}, POLL_INTERVAL_MS);
	}

	private stopPollTimer(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private startTickTimer(): void {
		this.stopTickTimer();
		this.tickTimer = window.setInterval(() => this.render(), 1000);
	}

	private stopTickTimer(): void {
		if (this.tickTimer !== null) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
	}

	private render(): void {
		const el = this.deps.statusBarEl;
		el.empty();
		const dot = el.createSpan({ cls: 'publisher-deploy-dot' });
		const label = el.createSpan({ cls: 'publisher-deploy-label' });
		dot.style.marginRight = '6px';
		dot.setText('●');

		switch (this.state.kind) {
			case 'unset':
				dot.style.color = 'var(--text-faint)';
				label.setText('Deploy: not configured');
				return;
			case 'polling': {
				dot.style.color = 'var(--color-accent)';
				const elapsed = Math.floor((Date.now() - this.state.startedAt) / 1000);
				const stage =
					this.state.latest?.stageName && this.state.latest.stageName !== 'unknown'
						? ` ${this.state.latest.stageName}`
						: '';
				label.setText(`Deploying${stage} · ${formatElapsed(elapsed)}`);
				return;
			}
			case 'idle': {
				const d = this.state.latest;
				if (!d) {
					dot.style.color = 'var(--text-faint)';
					label.setText('Deploy: no history');
					return;
				}
				const trail = d.commitHash
					? `${formatAgo(d.createdOn)} · ${d.commitHash}`
					: formatAgo(d.createdOn);
				if (d.stageStatus === 'failure' || d.stageStatus === 'canceled') {
					dot.style.color = 'var(--text-error)';
					label.setText(`Build ${d.stageStatus} · ${trail}`);
					this.deps.statusBarEl.title = d.commitMessage
						? `${d.commitMessage}\nClick to open the live site.`
						: 'Click to open the live site.';
					return;
				}
				if (d.stageStatus === 'success') {
					dot.style.color = 'var(--color-green)';
					label.setText(`Live · ${trail}`);
					this.deps.statusBarEl.title = d.commitMessage
						? `${d.commitMessage}\nClick to open the live site.`
						: 'Click to open the live site.';
					return;
				}
				if (d.stageStatus === 'building' || d.stageStatus === 'queued') {
					dot.style.color = 'var(--color-accent)';
					label.setText(`Deploying · ${d.stageName}`);
					return;
				}
				dot.style.color = 'var(--text-faint)';
				label.setText(`${d.stageName} · ${trail}`);
				return;
			}
			case 'error':
				dot.style.color = 'var(--text-error)';
				label.setText(`Deploy: ${this.state.message}`);
				return;
		}
	}

	private openTarget(): void {
		const target = this.preferredUrl();
		if (target) this.deps.openExternal(target);
	}

	private preferredUrl(): string | null {
		// Workers Builds doesn't expose per-build preview URLs the way Pages does,
		// so we always send the user to the live site.
		return this.deps.getSiteUrl() || null;
	}
}

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

function formatAgo(iso: string): string {
	const then = new Date(iso).getTime();
	if (isNaN(then)) return iso;
	const diff = Math.max(0, Math.floor((Date.now() - then) / 1000));
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}
