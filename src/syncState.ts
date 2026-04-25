/**
 * Per-file remote SHA tracking, used for conflict detection on publish.
 *
 * The plugin records the SHA it last saw on GitHub for each file (after pull
 * or after a successful publish). On the next publish, it re-fetches the
 * remote SHA and compares — if it differs and the local content has also
 * diverged from remote, that's a real conflict.
 *
 * Storage shape: { [filename]: sha }. Persisted via the plugin's loadData/
 * saveData (see main.ts).
 */

export type SyncedShas = Record<string, string>;

export interface SyncStateStore {
	get: (filename: string) => string | undefined;
	set: (filename: string, sha: string) => Promise<void>;
	remove: (filename: string) => Promise<void>;
}

export function createSyncStore(
	read: () => SyncedShas,
	write: (next: SyncedShas) => Promise<void>
): SyncStateStore {
	return {
		get: (filename) => read()[filename],
		set: async (filename, sha) => {
			const next = { ...read(), [filename]: sha };
			await write(next);
		},
		remove: async (filename) => {
			const next = { ...read() };
			delete next[filename];
			await write(next);
		}
	};
}
