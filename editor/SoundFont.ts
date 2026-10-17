// Added in Beepbox Reborn: reads .sf2 SoundFont files into sample sets.
// Only what BeepBox can play is used: each preset's key ranges, recordings,
// root keys, tuning and loops. Envelopes, filters, LFOs, modulators, panning and
// attenuation are left to BeepBox's own instrument settings.

import {SampleZone} from "../synth/SampleRegistry.js";

export class SoundFontError extends Error {}

export interface SoundFontPreset {
	readonly label: string;
	readonly bank: number;
	readonly program: number;
	readonly isNoise: boolean; // bank 128 is percussion
	readonly zones: ReadonlyArray<SampleZone>;
}

export interface SoundFont {
	readonly title: string;
	readonly presets: ReadonlyArray<SoundFontPreset>;
	readonly ignoredGenerators: ReadonlyArray<string>; // names of generators the file uses that BeepBox doesn't apply
	readonly decodedSampleBytes: number; // memory held by the decoded audio
}

const enum Gen {
	startAddrsOffset = 0,
	endAddrsOffset = 1,
	startloopAddrsOffset = 2,
	endloopAddrsOffset = 3,
	startAddrsCoarseOffset = 4,
	endAddrsCoarseOffset = 12,
	instrument = 41,
	keyRange = 43,
	velRange = 44,
	startloopAddrsCoarseOffset = 45,
	endloopAddrsCoarseOffset = 50,
	coarseTune = 51,
	fineTune = 52,
	sampleID = 53,
	sampleModes = 54,
	overridingRootKey = 58,
}

const handledGenerators: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 12, 41, 43, 44, 45, 50, 51, 52, 53, 54, 58]);
// Generators that are unused/reserved in the spec, so nothing is lost by skipping them.
const unusedGenerators: ReadonlySet<number> = new Set([14, 18, 19, 20, 42, 49, 55, 59, 60]);
const generatorNames: {readonly [id: number]: string} = {
	5: "modLfoToPitch", 6: "vibLfoToPitch", 7: "modEnvToPitch", 8: "initialFilterFc", 9: "initialFilterQ", 10: "modLfoToFilterFc", 11: "modEnvToFilterFc",
	13: "modLfoToVolume", 15: "chorusEffectsSend", 16: "reverbEffectsSend", 17: "pan", 21: "delayModLFO", 22: "freqModLFO", 23: "delayVibLFO", 24: "freqVibLFO",
	25: "delayModEnv", 26: "attackModEnv", 27: "holdModEnv", 28: "decayModEnv", 29: "sustainModEnv", 30: "releaseModEnv", 31: "keynumToModEnvHold", 32: "keynumToModEnvDecay",
	33: "delayVolEnv", 34: "attackVolEnv", 35: "holdVolEnv", 36: "decayVolEnv", 37: "sustainVolEnv", 38: "releaseVolEnv", 39: "keynumToVolEnvHold", 40: "keynumToVolEnvDecay",
	46: "keynum", 47: "velocity", 48: "initialAttenuation", 56: "scaleTuning", 57: "exclusiveClass",
};

// One generator list: id -> raw 16-bit amount (ranges keep both bytes).
type Generators = Map<number, number>;

interface Chunk {
	readonly offset: number;
	readonly length: number;
}

interface SampleHeader {
	readonly start: number;
	readonly end: number;
	readonly startLoop: number;
	readonly endLoop: number;
	readonly sampleRate: number;
	readonly originalPitch: number;
	readonly pitchCorrection: number;
	readonly sampleType: number;
}

interface CandidateZone {
	readonly keyLow: number;
	readonly keyHigh: number;
	readonly make: () => SampleZone; // decodes the audio, so only zones that are kept use memory
	readonly velLow: number;
	readonly velHigh: number;
	readonly isRightChannel: boolean;
}

function signed16(raw: number): number {
	return (raw & 0x8000) ? raw - 0x10000 : raw;
}

function readFourCC(view: DataView, offset: number): string {
	return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function readName(view: DataView, offset: number, length: number): string {
	let name: string = "";
	for (let i: number = 0; i < length; i++) {
		const code: number = view.getUint8(offset + i);
		if (code == 0) break;
		name += String.fromCharCode(code);
	}
	return name.trim();
}

// Lists the sub-chunks inside a chunk body. RIFF pads odd-sized chunks to even.
function readChunks(view: DataView, start: number, end: number): Array<{id: string, listType: string | null, offset: number, length: number}> {
	const result: Array<{id: string, listType: string | null, offset: number, length: number}> = [];
	let position: number = start;
	while (position + 8 <= end) {
		const id: string = readFourCC(view, position);
		const length: number = view.getUint32(position + 4, true);
		const offset: number = position + 8;
		if (offset + length > end) throw new SoundFontError("This SoundFont file is cut off or damaged.");
		const listType: string | null = (id == "LIST" && length >= 4) ? readFourCC(view, offset) : null;
		result.push({id, listType, offset, length});
		position = offset + length + (length & 1);
	}
	return result;
}

export function parseSoundFont(buffer: ArrayBuffer): SoundFont {
	const view: DataView = new DataView(buffer);
	if (buffer.byteLength < 12 || readFourCC(view, 0) != "RIFF" || readFourCC(view, 8) != "sfbk") {
		throw new SoundFontError("That file isn't a SoundFont (.sf2).");
	}
	const riffEnd: number = Math.min(buffer.byteLength, 8 + view.getUint32(4, true));

	let title: string = "";
	let majorVersion: number = 2;
	let smpl: Chunk | null = null;
	const pdta: {[id: string]: Chunk} = {};
	for (const list of readChunks(view, 12, riffEnd)) {
		if (list.id != "LIST" || list.listType == null) continue;
		for (const chunk of readChunks(view, list.offset + 4, list.offset + list.length)) {
			if (list.listType == "INFO") {
				if (chunk.id == "INAM") title = readName(view, chunk.offset, chunk.length);
				if (chunk.id == "ifil" && chunk.length >= 2) majorVersion = view.getUint16(chunk.offset, true);
			} else if (list.listType == "sdta") {
				if (chunk.id == "smpl") smpl = {offset: chunk.offset, length: chunk.length};
			} else if (list.listType == "pdta") {
				pdta[chunk.id] = {offset: chunk.offset, length: chunk.length};
			}
		}
	}
	if (majorVersion >= 3) throw new SoundFontError("That's a compressed SoundFont (.sf3), which isn't supported. Use the .sf2 version of it.");
	for (const id of ["phdr", "pbag", "pgen", "inst", "ibag", "igen", "shdr"]) {
		if (pdta[id] == undefined) throw new SoundFontError("This SoundFont file is missing its \"" + id + "\" section.");
	}
	if (smpl == null) throw new SoundFontError("This SoundFont file has no audio in it.");
	const smplChunk: Chunk = smpl;
	const sampleCount: number = smplChunk.length >> 1;

	const records = (id: string, size: number): number => Math.floor(pdta[id].length / size);

	const bagIndex = (id: string, i: number): number => view.getUint16(pdta[id].offset + i * 4, true);
	const generatorsBetween = (genId: string, from: number, to: number, seen: Set<number>): Generators => {
		const gens: Generators = new Map();
		const count: number = records(genId, 4);
		for (let g: number = from; g < to && g < count; g++) {
			const offset: number = pdta[genId].offset + g * 4;
			const oper: number = view.getUint16(offset, true);
			gens.set(oper, view.getUint16(offset + 2, true));
			seen.add(oper);
		}
		return gens;
	};

	const sampleHeaders: SampleHeader[] = [];
	for (let i: number = 0; i < records("shdr", 46); i++) {
		const offset: number = pdta["shdr"].offset + i * 46;
		const sampleType: number = view.getUint16(offset + 44, true);
		if (sampleType & 0x10) throw new SoundFontError("That's a compressed SoundFont (.sf3), which isn't supported. Use the .sf2 version of it.");
		sampleHeaders.push({
			start: view.getUint32(offset + 20, true),
			end: view.getUint32(offset + 24, true),
			startLoop: view.getUint32(offset + 28, true),
			endLoop: view.getUint32(offset + 32, true),
			sampleRate: view.getUint32(offset + 36, true),
			originalPitch: view.getUint8(offset + 40),
			pitchCorrection: view.getInt8(offset + 41),
			sampleType,
		});
	}

	const seenGenerators: Set<number> = new Set();

	// Each instrument as (global generators, zone generator lists).
	const instruments: Array<{global: Generators, zones: Generators[]}> = [];
	const instCount: number = records("inst", 22);
	for (let i: number = 0; i + 1 < instCount; i++) {
		const bagStart: number = view.getUint16(pdta["inst"].offset + i * 22 + 20, true);
		const bagEnd: number = view.getUint16(pdta["inst"].offset + (i + 1) * 22 + 20, true);
		let global: Generators = new Map();
		const zones: Generators[] = [];
		for (let b: number = bagStart; b < bagEnd; b++) {
			const gens: Generators = generatorsBetween("igen", bagIndex("ibag", b), bagIndex("ibag", b + 1), seenGenerators);
			if (gens.has(Gen.sampleID)) zones.push(gens);
			else if (b == bagStart) global = gens;
		}
		instruments.push({global, zones});
	}

	// Decoded audio is shared between zones that use the same stretch of a recording.
	const decoded: Map<string, Float32Array> = new Map();
	let decodedSampleBytes: number = 0;
	const decode = (start: number, end: number): Float32Array => {
		const key: string = start + ":" + end;
		let data: Float32Array | undefined = decoded.get(key);
		if (data == undefined) {
			data = new Float32Array(end - start);
			let byteOffset: number = smplChunk.offset + start * 2;
			for (let i: number = 0; i < data.length; i++, byteOffset += 2) data[i] = view.getInt16(byteOffset, true) / 32768;
			decoded.set(key, data);
			decodedSampleBytes += data.byteLength;
		}
		return data;
	};

	const amount = (gens: Generators, id: number, fallback: number = 0): number => gens.has(id) ? signed16(gens.get(id)!) : fallback;
	const range = (gens: Generators, id: number): [number, number] => {
		if (!gens.has(id)) return [0, 127];
		const raw: number = gens.get(id)!;
		return [raw & 0xFF, raw >> 8];
	};

	const presets: SoundFontPreset[] = [];
	const presetCount: number = records("phdr", 38);
	for (let p: number = 0; p + 1 < presetCount; p++) {
		const offset: number = pdta["phdr"].offset + p * 38;
		const program: number = view.getUint16(offset + 20, true);
		const bank: number = view.getUint16(offset + 22, true);
		const bagStart: number = view.getUint16(offset + 24, true);
		const bagEnd: number = view.getUint16(offset + 38 + 24, true);
		const label: string = readName(view, offset, 20) || ("Preset " + bank + ":" + program);

		let presetGlobal: Generators = new Map();
		const presetZones: Generators[] = [];
		for (let b: number = bagStart; b < bagEnd; b++) {
			const gens: Generators = generatorsBetween("pgen", bagIndex("pbag", b), bagIndex("pbag", b + 1), seenGenerators);
			if (gens.has(Gen.instrument)) presetZones.push(gens);
			else if (b == bagStart) presetGlobal = gens;
		}

		const candidates: CandidateZone[] = [];
		for (const presetZoneOwn of presetZones) {
			const presetZone: Generators = new Map([...presetGlobal, ...presetZoneOwn]);
			const instrument = instruments[amount(presetZone, Gen.instrument)];
			if (instrument == undefined) continue;
			const [pKeyLow, pKeyHigh] = range(presetZone, Gen.keyRange);
			const [pVelLow, pVelHigh] = range(presetZone, Gen.velRange);
			for (const instZoneOwn of instrument.zones) {
				const gens: Generators = new Map([...instrument.global, ...instZoneOwn]);
				const header: SampleHeader | undefined = sampleHeaders[amount(gens, Gen.sampleID)];
				if (header == undefined || (header.sampleType & 0x8000) || header.sampleRate <= 0) continue; // ROM samples aren't in the file
				const [iKeyLow, iKeyHigh] = range(gens, Gen.keyRange);
				const [iVelLow, iVelHigh] = range(gens, Gen.velRange);
				const keyLow: number = Math.max(pKeyLow, iKeyLow), keyHigh: number = Math.min(pKeyHigh, iKeyHigh);
				const velLow: number = Math.max(pVelLow, iVelLow), velHigh: number = Math.min(pVelHigh, iVelHigh);
				if (keyLow > keyHigh || velLow > velHigh) continue;

				const start: number = Math.max(0, header.start + amount(gens, Gen.startAddrsOffset) + 32768 * amount(gens, Gen.startAddrsCoarseOffset));
				const end: number = Math.min(sampleCount, header.end + amount(gens, Gen.endAddrsOffset) + 32768 * amount(gens, Gen.endAddrsCoarseOffset));
				if (end <= start) continue;
				const loopStart: number = header.startLoop + amount(gens, Gen.startloopAddrsOffset) + 32768 * amount(gens, Gen.startloopAddrsCoarseOffset);
				const loopEnd: number = header.endLoop + amount(gens, Gen.endloopAddrsOffset) + 32768 * amount(gens, Gen.endloopAddrsCoarseOffset);
				const modes: number = amount(gens, Gen.sampleModes) & 3;
				const loops: boolean = (modes == 1 || modes == 3) && loopStart >= start && loopEnd <= end && loopEnd > loopStart;

				const overridingRootKey: number = amount(gens, Gen.overridingRootKey, -1);
				const root: number = (overridingRootKey >= 0 && overridingRootKey <= 127) ? overridingRootKey : (header.originalPitch <= 127 ? header.originalPitch : 60);
				// Preset-level tuning adds to the instrument's.
				const tuneSemitones: number = amount(gens, Gen.coarseTune) + amount(presetZone, Gen.coarseTune) + (amount(gens, Gen.fineTune) + amount(presetZone, Gen.fineTune) + header.pitchCorrection) / 100;

				const rootKey: number = root - tuneSemitones;
				const make = (): SampleZone => loops
					? {keyLow, keyHigh, rootKey, sampleRate: header.sampleRate, data: decode(start, end), loopStart: loopStart - start, loopEnd: loopEnd - start}
					: {keyLow, keyHigh, rootKey, sampleRate: header.sampleRate, data: decode(start, end)};
				candidates.push({keyLow, keyHigh, make, velLow, velHigh, isRightChannel: (header.sampleType & 2) != 0});
			}
		}

		const zones: SampleZone[] = chooseZones(candidates);
		if (zones.length > 0) presets.push({label, bank, program, isNoise: bank == 128, zones});
	}
	presets.sort((a, b) => (a.bank - b.bank) || (a.program - b.program));

	const ignoredGenerators: string[] = [];
	for (const id of Array.from(seenGenerators).sort((a, b) => a - b)) {
		if (!handledGenerators.has(id) && !unusedGenerators.has(id)) ignoredGenerators.push(generatorNames[id] ?? ("generator " + id));
	}
	return {title, presets, ignoredGenerators, decodedSampleBytes};
}

const overlaps = (a: CandidateZone, b: CandidateZone): boolean => a.keyLow <= b.keyHigh && b.keyLow <= a.keyHigh;

// BeepBox has one loudness per note rather than MIDI velocity, so for each key
// it keeps the layer recorded around a medium-loud velocity (100). Stereo pairs
// are reduced to their left/mono side.
function chooseZones(candidates: ReadonlyArray<CandidateZone>): SampleZone[] {
	const atForte: CandidateZone[] = candidates.filter(c => c.velLow <= 100 && 100 <= c.velHigh);
	const byVelocity: CandidateZone[] = candidates.filter(c => atForte.indexOf(c) != -1 || !atForte.some(f => overlaps(f, c)));
	const leftOrMono: CandidateZone[] = byVelocity.filter(c => !c.isRightChannel);
	const kept: CandidateZone[] = byVelocity.filter(c => !c.isRightChannel || !leftOrMono.some(l => overlaps(l, c)));
	return kept.sort((a, b) => a.keyLow - b.keyLow).map(c => c.make());
}
