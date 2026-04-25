import { GitHubClient } from './github';

const STATUS = 301;

export interface RedirectsContext {
	github: GitHubClient;
	redirectsPath: string;
}

/**
 * Add a redirect rule to the Cloudflare _redirects file.
 * Reads → mutates → writes back through the GitHub API in one commit.
 */
export async function addRedirect(
	ctx: RedirectsContext,
	from: string,
	to: string,
	commitMessage: string
): Promise<void> {
	const fromPath = normalizePath(from);
	const toTarget = normalizeTarget(to);

	const existing = await ctx.github.getFile(ctx.redirectsPath);
	const currentText = existing?.content ?? '';
	const lines = currentText.split('\n');

	// Strip any prior rule for the same source (avoid chained or duplicate redirects)
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) return true;
		const [src] = trimmed.split(/\s+/);
		return src !== fromPath;
	});

	// Ensure trailing newline before appending
	while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') filtered.pop();
	filtered.push(`${fromPath} ${toTarget} ${STATUS}`);
	filtered.push('');

	const newText = filtered.join('\n');
	await ctx.github.putFile(ctx.redirectsPath, newText, commitMessage, existing?.sha);
}

function normalizePath(p: string): string {
	if (/^https?:\/\//.test(p)) return p;
	return p.startsWith('/') ? p : `/${p}`;
}

function normalizeTarget(t: string): string {
	if (/^https?:\/\//.test(t)) return t;
	return t.startsWith('/') ? t : `/${t}`;
}
