// Added in Beepbox Reborn: SoundFonts the user imported, kept in this browser.
// The raw .sf2 file is saved in IndexedDB and re-read on every page load, then
// each preset is registered as an "imported" sample set. Songs only store set
// names, so a song using one plays silence on a computer without the same font.
// Storage can be unavailable (private windows, managed school devices); then a
// font still works until the page is closed.

import {SampleRegistry, SampleZone} from "../synth/SampleRegistry.js";
import {parseSoundFont, SoundFont, SoundFontPreset, SoundFontError} from "./SoundFont.js";

export interface InstalledSoundFont {
	readonly name: string;
	readonly byteLength: number;
	readonly presetCount: number;
	readonly setNames: ReadonlyArray<string>;
	readonly ignoredGenerators: ReadonlyArray<string>;
}

interface StoredSoundFont {
	readonly name: string;
	readonly bytes: ArrayBuffer;
}

const databaseName: string = "beepboxRebornSoundFonts";
const storeName: string = "fonts";
const storageTimeoutMs: number = 8000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Browser storage didn't respond.")), storageTimeoutMs);
		promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
	});
}

function openDatabase(): Promise<IDBDatabase> {
	return withTimeout(new Promise<IDBDatabase>((resolve, reject) => {
		const request: IDBOpenDBRequest = indexedDB.open(databaseName, 1); // throws where storage is blocked
		request.onupgradeneeded = () => { request.result.createObjectStore(storeName, {keyPath: "name"}); };
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error("Browser storage is blocked."));
	}));
}

function runRequest<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDatabase().then(database => withTimeout(new Promise<T>((resolve, reject) => {
		const transaction: IDBTransaction = database.transaction(storeName, mode);
		const request: IDBRequest<T> = makeRequest(transaction.objectStore(storeName));
		let result: T;
		request.onsuccess = () => { result = request.result; };
		transaction.oncomplete = () => { database.close(); resolve(result); };
		transaction.onerror = () => { database.close(); reject(transaction.error ?? request.error); };
		transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Browser storage refused the change.")); };
	})));
}

export class SoundFontLibrary {
	private static readonly _fonts: InstalledSoundFont[] = [];
	private static readonly _listeners: Array<() => void> = [];
	private static _loadedSaved: Promise<void> | null = null;

	public static list(): ReadonlyArray<InstalledSoundFont> {
		return SoundFontLibrary._fonts.slice();
	}

	public static onChange(listener: () => void): void {
		SoundFontLibrary._listeners.push(listener);
	}

	public static offChange(listener: () => void): void {
		const index: number = SoundFontLibrary._listeners.indexOf(listener);
		if (index != -1) SoundFontLibrary._listeners.splice(index, 1);
	}

	// A file's name, minus its extension, names the font in the menus.
	public static nameFromFileName(fileName: string): string {
		const withoutExtension: string = fileName.replace(/\.sf2$/i, "").trim();
		return (withoutExtension || "SoundFont").substring(0, 60);
	}

	// Re-registers every font saved in this browser. Safe to call more than once.
	public static loadSaved(): Promise<void> {
		if (SoundFontLibrary._loadedSaved == null) {
			SoundFontLibrary._loadedSaved = (async (): Promise<void> => {
				let stored: StoredSoundFont[];
				try {
					stored = await runRequest<StoredSoundFont[]>("readonly", store => store.getAll());
				} catch (error) {
					console.warn("Imported SoundFonts aren't available because browser storage is unavailable:", error);
					return;
				}
				for (const font of stored) {
					try {
						SoundFontLibrary._install(font.name, font.bytes);
					} catch (error) {
						console.error("Couldn't load the saved SoundFont \"" + font.name + "\":", error);
					}
				}
			})();
		}
		return SoundFontLibrary._loadedSaved;
	}

	// Parses and installs a font, then tries to save it. Throws SoundFontError for a
	// file that can't be used. `saved` is false when the browser couldn't keep it.
	public static async importFile(fileName: string, bytes: ArrayBuffer): Promise<{font: InstalledSoundFont, saved: boolean}> {
		const name: string = SoundFontLibrary.nameFromFileName(fileName);
		const font: InstalledSoundFont = SoundFontLibrary._install(name, bytes);
		let saved: boolean = true;
		try {
			await runRequest("readwrite", store => store.put(<StoredSoundFont> {name, bytes}));
		} catch (error) {
			console.warn("Couldn't save the SoundFont \"" + name + "\" in this browser:", error);
			saved = false;
		}
		return {font, saved};
	}

	public static async remove(name: string): Promise<void> {
		const index: number = SoundFontLibrary._fonts.findIndex(font => font.name == name);
		if (index != -1) {
			const font: InstalledSoundFont = SoundFontLibrary._fonts[index];
			SoundFontLibrary._fonts.splice(index, 1);
			SampleRegistry.batch(() => { for (const setName of font.setNames) SampleRegistry.unregister(setName); });
			SoundFontLibrary._notify();
		}
		try {
			await runRequest("readwrite", store => store.delete(name));
		} catch (error) {
			console.warn("Couldn't remove the SoundFont \"" + name + "\" from browser storage:", error);
		}
	}

	private static _install(name: string, bytes: ArrayBuffer): InstalledSoundFont {
		const parsed: SoundFont = parseSoundFont(bytes);
		if (parsed.presets.length == 0) throw new SoundFontError("That SoundFont has no instruments BeepBox can play.");

		// Set names are what songs store, so they carry the font name to stay unique across fonts.
		const usedNames: Set<string> = new Set();
		const entries: Array<{setName: string, preset: SoundFontPreset}> = [];
		for (const preset of parsed.presets) {
			let setName: string = name + ": " + preset.label;
			if (usedNames.has(setName)) setName += " (" + preset.bank + ":" + preset.program + ")";
			for (let n: number = 2; usedNames.has(setName); n++) setName = name + ": " + preset.label + " #" + n;
			usedNames.add(setName);
			entries.push({setName, preset});
		}

		const previous: number = SoundFontLibrary._fonts.findIndex(font => font.name == name);
		const group: string = "Imported: " + name;
		SampleRegistry.batch(() => {
			if (previous != -1) {
				for (const setName of SoundFontLibrary._fonts[previous].setNames) {
					if (!usedNames.has(setName)) SampleRegistry.unregister(setName);
				}
			}
			for (const {setName, preset} of entries) {
				SampleRegistry.register(setName, <SampleZone[]> preset.zones, {category: "imported", isNoise: preset.isNoise, group, label: preset.label});
			}
		});

		const font: InstalledSoundFont = {name, byteLength: bytes.byteLength, presetCount: entries.length, setNames: entries.map(entry => entry.setName), ignoredGenerators: parsed.ignoredGenerators};
		if (previous != -1) SoundFontLibrary._fonts[previous] = font; else SoundFontLibrary._fonts.push(font);
		SoundFontLibrary._notify();
		return font;
	}

	private static _notify(): void {
		for (const listener of SoundFontLibrary._listeners) listener();
	}
}
