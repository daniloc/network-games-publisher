/**
 * Lightweight, style-preserving frontmatter mutation.
 *
 * Goal: change one field at a time without reformatting unrelated YAML.
 * Trade-off: regex-based, not a real YAML parser. Sufficient for the simple
 * shape of Network Games posts (flat scalars, plus tags/learnMore arrays
 * authored in a known style).
 */

interface Parts {
	prefix: string;
	fmBody: string;
	suffix: string;
}

function split(source: string): Parts | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
	if (!m) return null;
	return {
		prefix: source.slice(0, m.index) + '---\n',
		fmBody: m[1],
		suffix: '\n---' + source.slice(m.index + m[0].length)
	};
}

function recombine(parts: Parts): string {
	return `${parts.prefix}${parts.fmBody}${parts.suffix}`;
}

export function readField(source: string, key: string): string | undefined {
	const parts = split(source);
	if (!parts) return undefined;
	const re = new RegExp(`^${escapeKey(key)}:\\s*(.*)$`, 'm');
	const m = re.exec(parts.fmBody);
	if (!m) return undefined;
	return unquoteScalar(m[1]);
}

export function setField(source: string, key: string, value: string): string {
	const parts = split(source);
	if (!parts) return source;
	const newLine = `${key}: ${formatScalar(key, value)}`;
	const re = new RegExp(`^${escapeKey(key)}:.*$`, 'm');
	if (re.test(parts.fmBody)) {
		parts.fmBody = parts.fmBody.replace(re, newLine);
	} else {
		parts.fmBody = `${parts.fmBody}\n${newLine}`;
	}
	return recombine(parts);
}

export function removeField(source: string, key: string): string {
	const parts = split(source);
	if (!parts) return source;
	// Remove the field line and any indented continuation (for arrays/maps).
	const lines = parts.fmBody.split(/\r?\n/);
	const out: string[] = [];
	const headerRe = new RegExp(`^${escapeKey(key)}:`);
	let skipping = false;
	for (const line of lines) {
		if (skipping) {
			if (/^\s/.test(line)) continue;
			skipping = false;
		}
		if (headerRe.test(line)) {
			skipping = true;
			continue;
		}
		out.push(line);
	}
	parts.fmBody = out.join('\n');
	return recombine(parts);
}

export function readTags(source: string): string[] {
	const parts = split(source);
	if (!parts) return [];
	const lines = parts.fmBody.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^tags:\s*$/.test(l));
	if (idx === -1) {
		// Inline form: tags: [a, b]
		const inline = /^tags:\s*\[(.*)\]\s*$/m.exec(parts.fmBody);
		if (inline) {
			return inline[1]
				.split(',')
				.map((s) => unquoteScalar(s.trim()))
				.filter(Boolean);
		}
		return [];
	}
	const tags: string[] = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const l = lines[i];
		const m = /^\s+-\s*(.*)$/.exec(l);
		if (m) {
			tags.push(unquoteScalar(m[1]));
			continue;
		}
		if (/^\s/.test(l) || l.length === 0) continue;
		break;
	}
	return tags;
}

export function setTags(source: string, tags: string[]): string {
	const parts = split(source);
	if (!parts) return source;
	const lines = parts.fmBody.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^tags:\s*$/.test(l));

	// Remove inline form if present
	parts.fmBody = parts.fmBody.replace(/^tags:\s*\[.*\]\s*$/m, '');

	const tagBlock =
		tags.length > 0
			? ['tags:', ...tags.map((t) => `  - '${escapeSingle(t)}'`)]
			: [];

	if (idx === -1) {
		const linesAgain = parts.fmBody.split(/\r?\n/).filter((l) => l.length > 0);
		parts.fmBody = [...linesAgain, ...tagBlock].join('\n');
		return recombine(parts);
	}

	// Find end of existing tags block (next non-indented line)
	let end = lines.length;
	for (let i = idx + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.length === 0) continue;
		if (!/^\s/.test(l)) {
			end = i;
			break;
		}
	}
	const before = lines.slice(0, idx);
	const after = lines.slice(end);
	parts.fmBody = [...before, ...tagBlock, ...after].join('\n');
	return recombine(parts);
}

export function detectPostType(source: string): 'essay' | 'link' | 'note' {
	const parts = split(source);
	if (!parts) return 'essay';
	if (/^type:\s*note\b/m.test(parts.fmBody)) return 'note';
	if (/^link:\s*/m.test(parts.fmBody)) return 'link';
	return 'essay';
}

export interface LearnMoreEntry {
	title: string;
	url: string;
	description: string;
}

export function readLearnMore(source: string): LearnMoreEntry[] {
	const parts = split(source);
	if (!parts) return [];
	const lines = parts.fmBody.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^learnMore:\s*$/.test(l));
	if (idx === -1) return [];

	const entries: LearnMoreEntry[] = [];
	let current: Partial<LearnMoreEntry> | null = null;

	for (let i = idx + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.length === 0) continue;
		if (!/^\s/.test(l)) break;

		const itemMatch = /^\s+-\s+title:\s*(.*)$/.exec(l);
		if (itemMatch) {
			if (current) entries.push(completeEntry(current));
			current = { title: unquoteScalar(itemMatch[1]) };
			continue;
		}
		const fieldMatch = /^\s+(title|url|description):\s*(.*)$/.exec(l);
		if (fieldMatch && current) {
			const key = fieldMatch[1] as 'title' | 'url' | 'description';
			current[key] = unquoteScalar(fieldMatch[2]);
		}
	}
	if (current) entries.push(completeEntry(current));
	return entries;
}

export function setLearnMore(source: string, entries: LearnMoreEntry[]): string {
	const parts = split(source);
	if (!parts) return source;
	const lines = parts.fmBody.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^learnMore:\s*$/.test(l));

	const block =
		entries.length === 0
			? []
			: [
					'learnMore:',
					...entries.flatMap((e) => [
						`  - title: "${escapeDouble(e.title)}"`,
						`    url: '${escapeSingle(e.url)}'`,
						`    description: "${escapeDouble(e.description)}"`
					])
				];

	if (idx === -1) {
		if (entries.length === 0) return source;
		const before = lines.filter((l) => l.length > 0);
		parts.fmBody = [...before, ...block].join('\n');
		return recombine(parts);
	}

	let end = lines.length;
	for (let i = idx + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.length === 0) continue;
		if (!/^\s/.test(l)) {
			end = i;
			break;
		}
	}
	const before = lines.slice(0, idx);
	const after = lines.slice(end);
	parts.fmBody = [...before, ...block, ...after].join('\n');
	return recombine(parts);
}

function completeEntry(p: Partial<LearnMoreEntry>): LearnMoreEntry {
	return { title: p.title ?? '', url: p.url ?? '', description: p.description ?? '' };
}

function escapeDouble(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeKey(k: string): string {
	return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquoteScalar(raw: string): string {
	const s = raw.trim();
	if (s.length === 0) return '';
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
	}
	if (s.startsWith("'") && s.endsWith("'")) {
		return s.slice(1, -1).replace(/''/g, "'");
	}
	return s;
}

function formatScalar(key: string, value: string): string {
	// Style heuristic matching existing posts:
	//   date / updated → single-quoted (ISO date string)
	//   url / source / link → single-quoted (URL string)
	//   everything else → double-quoted
	if (key === 'date' || key === 'updated' || key === 'url' || key === 'source' || key === 'link') {
		return `'${escapeSingle(value)}'`;
	}
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeSingle(s: string): string {
	return s.replace(/'/g, "''");
}
