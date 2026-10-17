// Added in Beepbox Reborn. Reads a WAV recording and measures the note it was
// played at, to fill in "rootKey" for samples/manifest.json.
//   node scripts/measure-pitch.cjs samples/trumpet.wav
// Also used by scripts/bake-samples.cjs. A .cjs file because the package is "type": "module".

const fs = require("fs");

// Returns {sampleRate, data: Float32Array mono}. Handles 8/16/24/32-bit PCM and
// 32/64-bit float, mixing every channel down to one.
function readWav(path) {
	const bytes = fs.readFileSync(path);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const fourCC = (offset) => bytes.toString("latin1", offset, offset + 4);
	if (bytes.length < 12 || fourCC(0) != "RIFF" || fourCC(8) != "WAVE") throw new Error(path + " is not a WAV file.");
	let format = null;
	let dataOffset = -1, dataLength = 0;
	for (let position = 12; position + 8 <= bytes.length;) {
		const id = fourCC(position);
		const length = view.getUint32(position + 4, true);
		const offset = position + 8;
		if (id == "fmt ") {
			let tag = view.getUint16(offset, true);
			if (tag == 0xFFFE && length >= 26) tag = view.getUint16(offset + 24, true); // WAVE_FORMAT_EXTENSIBLE
			format = {tag, channels: view.getUint16(offset + 2, true), sampleRate: view.getUint32(offset + 4, true), bits: view.getUint16(offset + 14, true)};
		} else if (id == "data") {
			dataOffset = offset;
			dataLength = Math.min(length, bytes.length - offset);
		}
		position = offset + length + (length & 1);
	}
	if (format == null || dataOffset < 0) throw new Error(path + " has no audio format or data section.");
	const {tag, channels, sampleRate, bits} = format;
	const bytesPerSample = bits / 8;
	if (!((tag == 1 && [8, 16, 24, 32].includes(bits)) || (tag == 3 && [32, 64].includes(bits)))) {
		throw new Error(path + " uses an unsupported WAV encoding (format " + tag + ", " + bits + "-bit).");
	}
	const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
	const data = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame++) {
		let sum = 0;
		for (let channel = 0; channel < channels; channel++) {
			const offset = dataOffset + (frame * channels + channel) * bytesPerSample;
			let value;
			if (tag == 3) value = (bits == 32) ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
			else if (bits == 8) value = (view.getUint8(offset) - 128) / 128;
			else if (bits == 16) value = view.getInt16(offset, true) / 32768;
			else if (bits == 24) value = ((view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16))) / 8388608;
			else value = view.getInt32(offset, true) / 2147483648;
			sum += value;
		}
		data[frame] = sum / channels;
	}
	return {sampleRate, data};
}

// YIN pitch estimate for one window. Returns {frequency, confidence} or null.
function yin(data, start, windowLength, sampleRate) {
	const minTau = Math.max(2, Math.floor(sampleRate / 2000));
	const maxTau = Math.min(Math.floor(sampleRate / 30), Math.floor(windowLength / 2));
	const difference = new Float64Array(maxTau + 2);
	for (let tau = 1; tau <= maxTau + 1; tau++) {
		let sum = 0;
		for (let i = 0; i < windowLength; i++) {
			const delta = data[start + i] - data[start + i + tau];
			sum += delta * delta;
		}
		difference[tau] = sum;
	}
	const normalized = new Float64Array(maxTau + 2);
	normalized[0] = 1;
	let runningSum = 0;
	for (let tau = 1; tau <= maxTau + 1; tau++) {
		runningSum += difference[tau];
		normalized[tau] = runningSum > 0 ? difference[tau] * tau / runningSum : 1;
	}
	let best = -1;
	for (let tau = minTau; tau <= maxTau; tau++) {
		if (normalized[tau] < 0.15) {
			while (tau + 1 <= maxTau && normalized[tau + 1] < normalized[tau]) tau++;
			best = tau;
			break;
		}
	}
	if (best == -1) {
		best = minTau;
		for (let tau = minTau; tau <= maxTau; tau++) if (normalized[tau] < normalized[best]) best = tau;
	}
	const a = normalized[best - 1], b = normalized[best], c = normalized[best + 1];
	const denominator = a - 2 * b + c;
	const refined = denominator != 0 ? best + 0.5 * (a - c) / denominator : best;
	return {frequency: sampleRate / refined, confidence: 1 - b};
}

// Measures several loud stretches of the recording and checks they agree.
// Returns {midi, frequency, note, cents, confidence, ambiguous, reason}.
function measurePitch(data, sampleRate) {
	const windowLength = Math.ceil(sampleRate * 0.08);
	const needed = windowLength + Math.floor(sampleRate / 30) + 2;
	if (data.length < needed) return {ambiguous: true, reason: "the recording is too short to measure"};
	const frame = Math.floor(sampleRate * 0.05);
	const levels = [];
	for (let start = 0; start + needed <= data.length; start += frame) {
		let sum = 0;
		for (let i = 0; i < windowLength; i++) sum += data[start + i] * data[start + i];
		levels.push({start, rms: Math.sqrt(sum / windowLength)});
	}
	const loudest = Math.max(...levels.map(level => level.rms));
	if (!(loudest > 0)) return {ambiguous: true, reason: "the recording is silent"};
	// Skip the attack: the first loud frame is usually the noisiest.
	const loud = levels.filter(level => level.rms >= loudest * 0.3).slice(1);
	const step = Math.max(1, Math.floor(loud.length / 6));
	const estimates = [];
	for (let i = 0; i < loud.length && estimates.length < 6; i += step) {
		const estimate = yin(data, loud[i].start, windowLength, sampleRate);
		if (estimate != null) estimates.push(estimate);
	}
	if (estimates.length < 3) return {ambiguous: true, reason: "not enough steady sound to measure"};
	const midis = estimates.map(e => 69 + 12 * Math.log2(e.frequency / 440)).sort((a, b) => a - b);
	const midi = midis[Math.floor(midis.length / 2)];
	const confidence = estimates.map(e => e.confidence).sort((a, b) => a - b)[Math.floor(estimates.length / 2)];
	const spread = midis[midis.length - 1] - midis[0];
	const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
	const nearest = Math.round(midi);
	const result = {
		midi: Math.round(midi * 100) / 100,
		frequency: Math.round(440 * Math.pow(2, (midi - 69) / 12) * 10) / 10,
		note: names[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1),
		cents: Math.round((midi - nearest) * 100),
		confidence: Math.round(confidence * 100) / 100,
		ambiguous: false,
		reason: "",
	};
	if (confidence < 0.85) return {...result, ambiguous: true, reason: "the pitch isn't clear (confidence " + result.confidence + ")"};
	if (spread > 0.5) return {...result, ambiguous: true, reason: "different parts of the recording measure " + spread.toFixed(1) + " semitones apart"};
	return result;
}

module.exports = {readWav, measurePitch};

if (require.main === module) {
	const path = process.argv[2];
	if (!path) {
		console.error("Usage: node scripts/measure-pitch.cjs <recording.wav>");
		process.exit(1);
	}
	const {sampleRate, data} = readWav(path);
	const result = measurePitch(data, sampleRate);
	if (result.ambiguous) {
		console.log("Ambiguous: " + result.reason + "." + (result.midi != undefined ? " Best guess: " + result.note + " (rootKey " + result.midi + ")." : "") + " Ask which note was played.");
		process.exit(2);
	}
	console.log(result.note + " " + (result.cents >= 0 ? "+" : "") + result.cents + " cents, " + result.frequency + " Hz, confidence " + result.confidence + ". Proposed rootKey: " + result.midi);
}
