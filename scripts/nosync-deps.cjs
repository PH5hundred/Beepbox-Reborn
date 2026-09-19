// iCloud Drive syncs everything except paths ending in ".nosync", and this repo
// lives in iCloud. npm always rewrites node_modules as a real directory, so the
// symlink cannot simply be set up once - this restores it before each build.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// Only relevant inside iCloud Drive. On any other machine this is a no-op, so
// a fresh clone elsewhere gets a plain node_modules and no surprise symlink.
if (!root.includes("com~apple~CloudDocs")) process.exit(0);
const link = path.join(root, "node_modules");
const store = path.join(root, "node_modules.nosync");

if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) process.exit(0);
if (!fs.existsSync(link)) {
	if (!fs.existsSync(store)) {
		console.error("No dependencies found. Run: npm install");
		process.exit(1);
	}
} else {
	// npm replaced the link with a real directory; fold it back into the store.
	if (fs.existsSync(store)) fs.rmSync(store, {recursive: true, force: true});
	fs.renameSync(link, store);
}
fs.symlinkSync("node_modules.nosync", link);
console.log("node_modules relinked to node_modules.nosync (kept out of iCloud sync)");
