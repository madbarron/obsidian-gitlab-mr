import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

/**
 * Runs from the npm `version` lifecycle script, after npm has written the new
 * version into package.json. Mirrors it into manifest.json and records the
 * version -> minAppVersion pair in versions.json, so the tag, the manifest and
 * the compatibility map can never drift apart.
 *
 * Usage: npm version patch | minor | major
 */

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	console.error("version-bump: npm_package_version is not set — run this via `npm version`.");
	process.exit(1);
}

/** Rewrite a JSON file in place, keeping this repo's 2-space indent and trailing newline. */
function writeJson(file, value) {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeJson("manifest.json", manifest);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeJson("versions.json", versions);

console.log(`version-bump: ${targetVersion} (minAppVersion ${manifest.minAppVersion})`);
