import { readFileSync, writeFileSync } from 'fs';

// Bumps manifest.json's `version` to match package.json, and records the
// version → minAppVersion mapping in versions.json. Invoked by `npm version`
// via the `version` script in package.json.

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error('npm_package_version not set — run via `npm version <bump>`.');
	process.exit(1);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion}).`);
