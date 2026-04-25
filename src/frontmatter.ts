export interface BasePostMeta {
	title: string;
	date: string;
	excerpt: string;
	tags?: string[];
	updated?: string;
	learnMore?: LearnMoreEntry[];
}

export interface EssayMeta extends BasePostMeta {
	toc?: boolean;
	review?: ReviewMeta;
}

export interface LinkPostMeta extends BasePostMeta {
	link: string;
}

export interface NoteMeta extends BasePostMeta {
	type: 'note';
	source: string;
}

export interface LearnMoreEntry {
	title: string;
	url: string;
	description: string;
}

export interface ReviewMeta {
	title: string;
	rating?: string;
	url?: string;
}

export type AnyPostMeta = EssayMeta | LinkPostMeta | NoteMeta;

export function todayISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function slugify(text: string, maxLength = 80): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/['’"`]/g, '')
		.replace(/[^a-z0-9\s-]/g, ' ')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, maxLength)
		.replace(/-+$/g, '');
}

export function buildFrontmatter(meta: AnyPostMeta, body: string): string {
	const lines: string[] = ['---'];
	lines.push(`title: ${yamlString(meta.title)}`);
	lines.push(`date: '${meta.date}'`);
	lines.push(`excerpt: ${yamlString(meta.excerpt)}`);

	if (isNote(meta)) {
		lines.push(`type: note`);
		lines.push(`source: '${escapeSingle(meta.source)}'`);
	}

	if (isLink(meta)) {
		lines.push(`link: '${escapeSingle(meta.link)}'`);
	}

	if (meta.updated) {
		lines.push(`updated: '${meta.updated}'`);
	}

	if (meta.tags && meta.tags.length > 0) {
		lines.push('tags:');
		for (const tag of meta.tags) lines.push(`  - '${escapeSingle(tag)}'`);
	}

	if (meta.learnMore && meta.learnMore.length > 0) {
		lines.push('learnMore:');
		for (const entry of meta.learnMore) {
			lines.push(`  - title: ${yamlString(entry.title)}`);
			lines.push(`    url: '${escapeSingle(entry.url)}'`);
			lines.push(`    description: ${yamlString(entry.description)}`);
		}
	}

	lines.push('---');
	lines.push('');
	lines.push(body);
	if (!body.endsWith('\n')) lines.push('');
	return lines.join('\n');
}

export function isNote(meta: AnyPostMeta): meta is NoteMeta {
	return (meta as NoteMeta).type === 'note';
}

export function isLink(meta: AnyPostMeta): meta is LinkPostMeta {
	return typeof (meta as LinkPostMeta).link === 'string';
}

function yamlString(s: string): string {
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeSingle(s: string): string {
	return s.replace(/'/g, "''");
}
