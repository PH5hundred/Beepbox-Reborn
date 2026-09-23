#!/usr/bin/env node
// Copies the freshly built offline editor into a Google Drive folder, so the
// shared copy is never behind the build. Runs after every `npm run build`.
//
// It does nothing unless that folder is actually there, the same way
// nosync-deps.cjs does nothing outside iCloud Drive, so a clone on any other
// machine builds normally and never sees this.
//
// Google Drive for Desktop mounts as a file provider. While it is still
// indexing, or if macOS has not activated its extension, reads on that path
// hang rather than failing - so every call here is given a deadline and a hang
// is treated as "not available" instead of wedging the build.

const fs = require("fs");
const path = require("path");
const os = require("os");
const {execFileSync} = require("child_process");

const FOLDER_NAME = "BeepBox Reborn";
const SOURCE = path.join(__dirname, "..", "website", "beepbox_offline.html");
const DEADLINE_MS = 8000;

// Probing the mount in-process would block the event loop with no way out, so
// each check runs in a child that can simply be killed.
function reachable(target) {
	try {
		execFileSync(process.execPath, ["-e", `require("fs").readdirSync(${JSON.stringify(target)})`],
			{timeout: DEADLINE_MS, stdio: "ignore"});
		return true;
	} catch (error) {
		return false;
	}
}

function findDriveFolders() {
	const cloudStorage = path.join(os.homedir(), "Library", "CloudStorage");
	let entries;
	try {
		entries = fs.readdirSync(cloudStorage);
	} catch (error) {
		return [];
	}
	const found = [];
	for (const entry of entries) {
		if (!entry.startsWith("GoogleDrive-")) continue;
		for (const root of ["My Drive", "Shared drives"]) {
			const candidate = path.join(cloudStorage, entry, root, FOLDER_NAME);
			if (reachable(candidate)) found.push(candidate);
		}
	}
	return found;
}

function main() {
	if (!fs.existsSync(SOURCE)) return;   // nothing built yet

	const targets = findDriveFolders();
	if (targets.length === 0) {
		// Silent by design: this is the normal case on any machine that does not
		// have the folder, and a build should not look like it half-failed.
		return;
	}
	for (const target of targets) {
		const destination = path.join(target, "beepbox_offline.html");
		try {
			execFileSync(process.execPath, ["-e",
				`require("fs").copyFileSync(${JSON.stringify(SOURCE)}, ${JSON.stringify(destination)})`],
				{timeout: DEADLINE_MS * 4, stdio: "ignore"});
			const size = fs.statSync(SOURCE).size;
			console.log(`drive-drop: copied beepbox_offline.html (${Math.round(size / 1024)} KB) to ${target}`);
		} catch (error) {
			console.log(`drive-drop: could not write to ${target} (Drive may still be syncing) - skipped`);
		}
	}
}

main();
