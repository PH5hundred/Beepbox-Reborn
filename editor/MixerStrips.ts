// Added in Beepbox Reborn: a mixing-desk view of the song. One vertical strip per
// instrument with a level meter, a fader and a dB readout.
//
// The meter is live: it shows how loud that instrument actually is in the mix
// right now, measured in the synth, so it moves with the notes and falls away
// in silence. The fader sets the instrument's AVERAGE level across the whole song
// by shifting every measure by the same amount, so the shape of its dynamics is
// kept and only the average comes down. The fader edits the same per-measure
// volumes the "Per measure" grid does, so the two can never disagree, and the
// meter follows them because it measures the resulting sound.

import {Config} from "../synth/SynthConfig.js";
import {ColorConfig} from "./ColorConfig.js";
import {SongDocument} from "./SongDocument.js";
import {ChangeGroup} from "./Change.js";
import {ChangeMeasureVolume} from "./changes.js";
import {HTML} from "imperative-html/dist/esm/elements-strict.js";

const meterHeight: number = 150;
const thumbHeight: number = 12;
// One volume step is a fixed number of decibels; take it from the config
// rather than restating it, so the readout follows the synth.
const dbPerStep: number = -Config.volumeLogScale * 20 * Math.log10(2);
// The meter reads in dB of full scale, like a mixing desk's; it is a different
// scale from the fader's, which counts down from the instrument's own full volume.
const meterFloor: number = -48;
const scaleMarks: number[] = [0, -12, -24, -36, -48];
// How fast a reading falls back once the sound stops, in dB per animation frame.
const meterFall: number = 0.9;

interface Strip {
	readonly container: HTMLDivElement;
	readonly name: HTMLDivElement;
	readonly db: HTMLDivElement;
	readonly meterLive: HTMLDivElement;
	readonly thumb: HTMLDivElement;
	readonly fader: HTMLDivElement;
	readonly mute: HTMLButtonElement;
}

function stepToDb(step: number): number {
	return -dbPerStep * (Config.measureVolumeMax - step);
}

export class MixerStrips {
	public readonly container: HTMLDivElement = HTML.div({class: "stripRow"});
	private readonly _strips: Strip[] = [];
	
	private readonly _shownDb: number[] = [];
	private _dragChannel: number = -1;
	private _dragSnapshot: number[] = [];
	private _dragAverage: number = 0;
	private _group: ChangeGroup | null = null;
	
	constructor(private readonly _doc: SongDocument) {
		window.requestAnimationFrame(this._animate);
	}
	
	private _average(channel: number): number {
		const count: number = this._doc.song.barCount;
		let sum: number = 0;
		for (let bar: number = 0; bar < count; bar++) sum += this._doc.song.getBarVolume(channel, bar);
		return sum / count;
	}
	
	private _buildStrip(channel: number): Strip {
		const name: HTMLDivElement = HTML.div({class: "stripName"});
		const db: HTMLDivElement = HTML.div({class: "stripDb"});
		
		// Scale marks are placed by the dB they name, so they cannot drift from the meter.
		const scale: HTMLDivElement = HTML.div({class: "stripScale", style: `height: ${meterHeight}px;`});
		for (const mark of scaleMarks) {
			const label: HTMLDivElement = HTML.div({class: "stripMark", style: `top: ${(mark / meterFloor) * (meterHeight - 8)}px;`}, String(mark));
			scale.appendChild(label);
		}
		
		const meterLive: HTMLDivElement = HTML.div({class: "meterLive"});
		const meter: HTMLDivElement = HTML.div({class: "stripMeter", style: `height: ${meterHeight}px;`},
			HTML.div({class: "meterDim"}),
			meterLive,
		);
		
		const thumb: HTMLDivElement = HTML.div({class: "stripThumb", style: `height: ${thumbHeight}px;`});
		const fader: HTMLDivElement = HTML.div({class: "stripFader", title: "Drag to lower or raise this instrument's average volume across the whole song", style: `height: ${meterHeight}px;`},
			HTML.div({class: "stripTrack"}),
			thumb,
		);
		fader.addEventListener("pointerdown", event => this._onFaderDown(channel, event));
		fader.addEventListener("pointermove", event => this._onFaderMove(channel, event));
		fader.addEventListener("pointerup", event => this._onFaderUp(channel, event));
		fader.addEventListener("pointercancel", event => this._onFaderUp(channel, event));
		
		const mute: HTMLButtonElement = HTML.button({type: "button", class: "stripMute", title: "Mute or unmute this instrument"});
		mute.addEventListener("click", () => {
			this._doc.song.channels[channel].muted = !this._doc.song.channels[channel].muted;
			this._doc.notifier.changed();
		});
		
		const container: HTMLDivElement = HTML.div({class: "strip"},
			name,
			db,
			HTML.div({class: "stripBody"}, scale, meter, fader),
			mute,
		);
		return {container, name, db, meterLive, thumb, fader, mute};
	}
	
	private _faderTarget(strip: Strip, event: PointerEvent): number {
		const rect: DOMRect = strip.fader.getBoundingClientRect();
		const usable: number = meterHeight - thumbHeight;
		const fraction: number = 1 - (event.clientY - rect.top - thumbHeight / 2) / usable;
		return Math.max(0, Math.min(1, fraction)) * Config.measureVolumeMax;
	}
	
	private _onFaderDown(channel: number, event: PointerEvent): void {
		if (event.button != 0) return;
		const strip: Strip = this._strips[channel];
		strip.fader.setPointerCapture(event.pointerId);
		this._dragChannel = channel;
		this._group = new ChangeGroup();
		// Every move is measured from how the instrument stood when the fader was
		// grabbed, not from the last move, so dragging back up gives back exactly
		// what dragging down took, even for measures that hit the floor on the way.
		this._dragSnapshot = [];
		for (let bar: number = 0; bar < this._doc.song.barCount; bar++) {
			this._dragSnapshot.push(this._doc.song.getBarVolume(channel, bar));
		}
		this._dragAverage = this._average(channel);
		this._applyTarget(this._faderTarget(strip, event));
	}
	
	private _onFaderMove(channel: number, event: PointerEvent): void {
		if (this._group == null || channel != this._dragChannel) return;
		this._applyTarget(this._faderTarget(this._strips[channel], event));
	}
	
	private _onFaderUp(channel: number, event: PointerEvent): void {
		if (this._group == null || channel != this._dragChannel) return;
		this._doc.record(this._group);
		this._group = null;
		this._dragChannel = -1;
	}
	
	private _applyTarget(target: number): void {
		const group: ChangeGroup | null = this._group;
		if (group == null) return;
		const shift: number = target - this._dragAverage;
		for (let bar: number = 0; bar < this._dragSnapshot.length; bar++) {
			const value: number = Math.max(0, Math.min(Config.measureVolumeMax, Math.round(this._dragSnapshot[bar] + shift)));
			const old: number = this._doc.song.getBarVolume(this._dragChannel, bar);
			if (old != value) group.append(new ChangeMeasureVolume(this._doc, this._dragChannel, bar, old, value));
		}
		this._doc.setProspectiveChange(group);
	}
	
	private _animate = (): void => {
		// Only measure while the meters are on screen; the synth skips the work otherwise.
		const visible: boolean = this.container.offsetParent != null;
		this._doc.synth.measureLevels = visible;
		if (visible && this._strips.length > 0) this._renderMeters();
		window.requestAnimationFrame(this._animate);
	}
	
	private _renderMeters(): void {
		const peaks: number[] = this._doc.synth.channelPeaks;
		for (let channel: number = 0; channel < this._strips.length; channel++) {
			const peak: number = peaks[channel] || 0;
			peaks[channel] = 0;
			const measured: number = peak > 0 ? 20 * Math.log10(peak) : meterFloor;
			// Rise at once, fall gradually, so a short note can still be seen.
			const shown: number = Math.max(measured, (this._shownDb[channel] === undefined ? meterFloor : this._shownDb[channel]) - meterFall, meterFloor);
			this._shownDb[channel] = Math.min(0, shown);
			const fraction: number = (this._shownDb[channel] - meterFloor) / -meterFloor;
			this._strips[channel].meterLive.style.clipPath = `inset(${(1 - fraction) * 100}% 0 0 0)`;
		}
	}
	
	public render(): void {
		const song = this._doc.song;
		const count: number = song.getChannelCount();
		while (this._strips.length < count) {
			const strip: Strip = this._buildStrip(this._strips.length);
			this._strips.push(strip);
			this.container.appendChild(strip.container);
		}
		while (this._strips.length > count) this.container.removeChild(this._strips.pop()!.container);
		
		for (let channel: number = 0; channel < count; channel++) {
			const strip: Strip = this._strips[channel];
			const average: number = this._average(channel);
			strip.name.textContent = "Channel " + (channel + 1);
			strip.name.style.color = ColorConfig.getChannelColor(song, channel).primaryChannel;
			strip.db.textContent = (Math.round(stepToDb(average) * 10) / 10).toFixed(1) + " dB";
			strip.thumb.style.top = ((1 - average / Config.measureVolumeMax) * (meterHeight - thumbHeight)) + "px";
			strip.mute.classList.toggle("muted", song.channels[channel].muted);
			strip.container.classList.toggle("selected", channel == this._doc.channel);
			strip.container.classList.toggle("muted", song.channels[channel].muted);
		}
		this._renderMeters();
	}
}
