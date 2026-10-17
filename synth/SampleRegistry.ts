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
}

export interface SampleSetOptions {
	readonly category?: SampleCategory; // default "sampled"
	readonly isNoise?: boolean; // default false
}

const sets: SampleSet[] = [];
const listeners: Array<() => void> = [];

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
		const set: SampleSet = {name, category: options.category ?? "sampled", isNoise: options.isNoise ?? false, zones: zones.slice()};
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
		for (const listener of listeners) listener();
	}
}
