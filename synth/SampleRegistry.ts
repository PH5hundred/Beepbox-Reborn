// Added in Beepbox Reborn: recorded audio for the "sample" instrument type.
// Songs only store a set's NAME (a URL cannot hold audio), so the audio itself
// has to be registered here by whatever supplies it: a build step that bakes
// recordings in, or an import feature. A song naming a set that isn't
// registered plays silence instead of failing to load.

export interface SampleZone {
	readonly keyLow: number; // MIDI pitch, inclusive
	readonly keyHigh: number; // MIDI pitch, inclusive
	readonly rootKey: number; // MIDI pitch the recording was made at
	readonly sampleRate: number;
	readonly data: Float32Array; // mono
	readonly loopStart?: number; // in samples; looping needs both ends and loopEnd > loopStart
	readonly loopEnd?: number;
}

export type SampleCategory = "imported" | "sampled";

export interface SampleSet {
	readonly name: string;
	readonly category: SampleCategory;
	readonly isNoise: boolean; // shown in the drum channel's menu instead of the pitched one
	readonly zones: ReadonlyArray<SampleZone>;
	readonly group: string; // instrument-menu group it is listed under
	readonly label: string; // its name in that menu; the set name stays the unique key songs store
}

export interface SampleSetOptions {
	readonly category?: SampleCategory; // default "sampled"
	readonly isNoise?: boolean; // default false
	readonly group?: string; // default "Sampled Instruments" or "Imported", by category
	readonly label?: string; // default the set name
}

const sets: SampleSet[] = [];
const listeners: Array<() => void> = [];
let batchDepth: number = 0;
let changedDuringBatch: boolean = false;

function validateZone(zone: SampleZone): void {
	if (!(zone.data instanceof Float32Array) || zone.data.length == 0) throw new Error("Sample zone has no audio data.");
	if (!(zone.sampleRate > 0)) throw new Error("Sample zone needs a positive sample rate.");
	if (!(zone.keyLow <= zone.keyHigh)) throw new Error("Sample zone keyLow must not exceed keyHigh.");
	if (!isFinite(zone.rootKey)) throw new Error("Sample zone needs a root key.");
}

export class SampleRegistry {
	// Re-registering a name replaces that set in place, keeping its position, so
	// menu entries derived from registration order stay put.
	public static register(name: string, zones: ReadonlyArray<SampleZone>, options: SampleSetOptions = {}): SampleSet {
		if (name == "") throw new Error("A sample set needs a name.");
		if (zones.length == 0) throw new Error("A sample set needs at least one zone.");
		for (const zone of zones) validateZone(zone);
		const category: SampleCategory = options.category ?? "sampled";
		const group: string = options.group ?? (category == "sampled" ? "Sampled Instruments" : "Imported");
		const set: SampleSet = {name, category, isNoise: options.isNoise ?? false, zones: zones.slice(), group, label: options.label ?? name};
		const index: number = sets.findIndex(existing => existing.name == name);
		if (index == -1) sets.push(set); else sets[index] = set;
		SampleRegistry._notify();
		return set;
	}

	public static unregister(name: string): boolean {
		const index: number = sets.findIndex(existing => existing.name == name);
		if (index == -1) return false;
		sets.splice(index, 1);
		SampleRegistry._notify();
		return true;
	}

	public static get(name: string): SampleSet | undefined {
		return sets.find(set => set.name == name);
	}

	public static list(): ReadonlyArray<SampleSet> {
		return sets.slice();
	}

	// Registers or removes many sets with a single change notification, so a
	// SoundFont with hundreds of presets rebuilds the menus once, not per preset.
	public static batch(callback: () => void): void {
		batchDepth++;
		try {
			callback();
		} finally {
			batchDepth--;
			if (batchDepth == 0 && changedDuringBatch) {
				changedDuringBatch = false;
				SampleRegistry._notify();
			}
		}
	}

	public static onChange(listener: () => void): void {
		listeners.push(listener);
	}

	// A note outside every zone uses the nearest one rather than going silent.
	public static findZone(set: SampleSet, midiPitch: number): SampleZone {
		let best: SampleZone = set.zones[0];
		let bestDistance: number = Infinity;
		for (const zone of set.zones) {
			const distance: number = (midiPitch < zone.keyLow) ? zone.keyLow - midiPitch : (midiPitch > zone.keyHigh) ? midiPitch - zone.keyHigh : 0;
			if (distance < bestDistance) {
				best = zone;
				bestDistance = distance;
				if (distance == 0) break;
			}
		}
		return best;
	}

	private static _notify(): void {
		if (batchDepth > 0) {
			changedDuringBatch = true;
			return;
		}
		for (const listener of listeners) listener();
	}
}
