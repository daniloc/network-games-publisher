import { requestUrl } from 'obsidian';

export interface PageMetadata {
	title: string;
	description: string;
	siteName: string;
	canonicalUrl: string;
	imageUrl?: string;
}

export async function fetchPageMetadata(url: string): Promise<PageMetadata> {
	const res = await requestUrl({
		url,
		method: 'GET',
		headers: {
			'User-Agent':
				'Mozilla/5.0 (compatible; NetworkGamesPublisher/0.1; +https://networkgames.fyi)'
		},
		throw: false
	});

	if (res.status >= 400) {
		throw new Error(`Could not fetch ${url} → HTTP ${res.status}`);
	}

	const html = res.text ?? '';
	const get = (prop: string) =>
		decode(
			matchMeta(html, `property=["']${prop}["']`) ??
				matchMeta(html, `name=["']${prop}["']`)
		);

	const ogTitle = get('og:title');
	const ogDescription = get('og:description') ?? get('twitter:description') ?? get('description');
	const ogImage = get('og:image');
	const ogSiteName = get('og:site_name');

	const docTitle = decode(matchTag(html, 'title'));

	return {
		title: ogTitle ?? docTitle ?? url,
		description: ogDescription ?? '',
		siteName: ogSiteName ?? domainOf(url),
		canonicalUrl: url,
		imageUrl: ogImage ?? undefined
	};
}

function matchMeta(html: string, attr: string): string | null {
	// Backreference \1/\2 ensures the closing quote matches the opening one,
	// so an apostrophe inside content="..." doesn't truncate the value.
	const before = new RegExp(`<meta[^>]+${attr}[^>]+content=(["'])([\\s\\S]*?)\\1`, 'i').exec(html);
	if (before) return before[2];
	const after = new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+${attr}`, 'i').exec(html);
	if (after) return after[2];
	return null;
}

function matchTag(html: string, tag: string): string | null {
	const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
	return m ? m[1].trim() : null;
}

function decode(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	return value
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#039;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, '/')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&mdash;/g, '—')
		.replace(/&ndash;/g, '–')
		.replace(/\s+/g, ' ')
		.trim();
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}
