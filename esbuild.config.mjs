import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// Optional .env — see .env.example.
try {
	process.loadEnvFile(".env");
} catch {
	/* no .env, fall back to ./dist */
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

/** `~/vaults/notes` and `~` are resolved against the current user's home directory. */
function expandHome(target) {
	if (target === "~") return os.homedir();
	if (target.startsWith("~/") || target.startsWith("~\\")) {
		return path.join(os.homedir(), target.slice(2));
	}
	return target;
}

/**
 * Where the build lands, in order of precedence:
 *   OBSIDIAN_PLUGIN_DIR — the plugin folder itself
 *   OBSIDIAN_VAULT      — a vault; relative paths resolve from your home directory
 *   neither             — ./dist, so a fresh clone builds without any configuration
 */
function resolveOutDir() {
	const explicit = process.env.OBSIDIAN_PLUGIN_DIR?.trim();
	if (explicit) return path.resolve(expandHome(explicit));

	const vault = process.env.OBSIDIAN_VAULT?.trim();
	if (vault) {
		const expanded = expandHome(vault);
		const root = path.isAbsolute(expanded) ? expanded : path.join(os.homedir(), expanded);
		return path.join(root, ".obsidian", "plugins", manifest.id);
	}

	return path.resolve("dist");
}

const outDir = resolveOutDir();
const ASSETS = ["manifest.json", "styles.css"];

function copyAssets() {
	fs.mkdirSync(outDir, { recursive: true });
	for (const asset of ASSETS) {
		if (fs.existsSync(asset)) fs.copyFileSync(asset, path.join(outDir, asset));
	}
}

const reportPlugin = {
	name: "report",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length) return;
			copyAssets();
			console.log(`[${new Date().toLocaleTimeString()}] built -> ${outDir}`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: path.join(outDir, "main.js"),
	plugins: [reportPlugin],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
	console.log(`watching... output: ${outDir}`);
}
