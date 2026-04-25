import { requestUrl } from 'obsidian';
import { fetchPageMetadata } from './openGraph';

const API = 'https://public.api.bsky.app/xrpc';

export interface BlueskyPostExtract {
	text: string;
	createdAt: string;
	embedMarkdown: string;
}

export interface BlueskyThread {
	posts: BlueskyPostExtract[];
	authorHandle: string;
	rootUrl: string;
}

interface BskyFacet {
	index: { byteStart: number; byteEnd: number };
	features: Array<{ $type: string; uri?: string }>;
}

interface BskyPostRecord {
	text: string;
	facets?: BskyFacet[];
	createdAt: string;
	embed?: BskyEmbed;
}

interface BskyEmbedExternal {
	uri: string;
	title?: string;
	description?: string;
}

interface BskyEmbed {
	$type: string;
	external?: BskyEmbedExternal;
}

interface BskyPost {
	uri: string;
	author: { did: string; handle: string };
	record: BskyPostRecord;
	embed?: BskyEmbed;
}

interface BskyThreadNode {
	$type?: string;
	post: BskyPost;
	replies?: BskyThreadNode[];
}

export function parseBlueskyUrl(url: string): { handle: string; postId: string } {
	const m = /bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(url);
	if (!m) throw new Error('Not a Bluesky post URL.');
	return { handle: m[1], postId: m[2] };
}

export async function fetchBlueskyThread(url: string): Promise<BlueskyThread> {
	const { handle, postId } = parseBlueskyUrl(url);
	const did = await resolveHandle(handle);
	const atUri = `at://${did}/app.bsky.feed.post/${postId}`;
	const res = await requestUrl({
		url: `${API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=100`,
		throw: false
	});
	if (res.status !== 200) {
		throw new Error(`Bluesky thread fetch failed (${res.status}).`);
	}
	const data = res.json as { thread: BskyThreadNode };

	const ordered: BlueskyPostExtract[] = [];
	await collectAuthorPosts(data.thread, did, ordered);
	ordered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

	if (ordered.length === 0) throw new Error('No posts found in thread.');

	return { posts: ordered, authorHandle: handle, rootUrl: url };
}

async function resolveHandle(handle: string): Promise<string> {
	const res = await requestUrl({
		url: `${API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
		throw: false
	});
	if (res.status !== 200) {
		throw new Error(`Could not resolve Bluesky handle "${handle}".`);
	}
	const body = res.json as { did: string };
	return body.did;
}

async function collectAuthorPosts(
	node: BskyThreadNode | undefined,
	authorDid: string,
	out: BlueskyPostExtract[]
): Promise<void> {
	if (!node || node.$type === 'app.bsky.feed.defs#notFoundPost') return;
	const post = node.post;
	if (post && post.author.did === authorDid) {
		const record = post.record;
		const text = applyFacets(record.text, record.facets ?? []);
		const embed = await renderEmbed(record.embed ?? post.embed);
		out.push({ text, createdAt: record.createdAt, embedMarkdown: embed });
	}
	if (node.replies) {
		for (const reply of node.replies) {
			if (reply.post?.author?.did === authorDid) {
				await collectAuthorPosts(reply, authorDid, out);
			}
		}
	}
}

function applyFacets(text: string, facets: BskyFacet[]): string {
	if (!facets.length) return text;
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const bytes = enc.encode(text);
	const sorted = [...facets].sort((a, b) => b.index.byteStart - a.index.byteStart);
	let out = bytes;
	for (const facet of sorted) {
		const link = facet.features.find((f) => f.$type === 'app.bsky.richtext.facet#link');
		if (!link?.uri) continue;
		const before = out.slice(0, facet.index.byteStart);
		const after = out.slice(facet.index.byteEnd);
		const display = dec.decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd));
		const replacement = enc.encode(`[${display}](${link.uri})`);
		const merged = new Uint8Array(before.length + replacement.length + after.length);
		merged.set(before, 0);
		merged.set(replacement, before.length);
		merged.set(after, before.length + replacement.length);
		out = merged;
	}
	return dec.decode(out);
}

async function renderEmbed(embed: BskyEmbed | undefined): Promise<string> {
	if (!embed) return '';
	if (
		(embed.$type === 'app.bsky.embed.external' ||
			embed.$type === 'app.bsky.embed.external#view') &&
		embed.external
	) {
		const ext = embed.external;
		try {
			const meta = await fetchPageMetadata(ext.uri);
			if (!meta.imageUrl) return '';
			const title = ext.title || meta.title || domainOf(ext.uri);
			return `\n[![${escapeAlt(title)}](${meta.imageUrl})](${ext.uri})\n`;
		} catch {
			return '';
		}
	}
	return '';
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

function escapeAlt(s: string): string {
	return s.replace(/\]/g, '\\]');
}
