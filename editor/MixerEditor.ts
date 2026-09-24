// Added in Beepbox Reborn: one volume bar per instrument per measure, laid out on
// the same grid as the track editor so the mute buttons still line up with it.

import {Config} from "../synth/SynthConfig.js";
import {ColorConfig, ChannelColors} from "./ColorConfig.js";
import {SongDocument} from "./SongDocument.js";
import {ChannelRow} from "./ChannelRow.js";
import {Change, ChangeGroup} from "./Change.js";
import {ChangeMeasureVolume} from "./changes.js";
import {HTML, SVG} from "imperative-html/dist/esm/elements-strict.js";

interface Cell {
	readonly back: SVGRectElement;
	readonly fill: SVGRectElement;
}

export class MixerEditor {
	private static readonly _inset: number = 2;

	private readonly _selection: SVGRectElement = SVG.rect({fill: "none", stroke: ColorConfig.hoverPreview, "stroke-width": 2, "pointer-events": "none"});
	private readonly _svg: SVGSVGElement = SVG.svg({style: "position: absolute; top: 0; left: 0;"}, this._selection);
	public readonly container: HTMLElement = HTML.div({class: "mixerEditor noSelection", style: "position: relative; overflow: hidden; touch-action: none; cursor: ns-resize;"}, this._svg);

	private readonly _cells: Cell[][] = [];
	private _renderedSignature: string = "";

	private _dragChannel: number = -1;
	private _dragBar: number = -1;
	private _group: ChangeGroup | null = null;

	constructor(private readonly _doc: SongDocument) {
		this.container.addEventListener("pointerdown", this._onPointerDown);
		this.container.addEventListener("pointermove", this._onPointerMove);
		this.container.addEventListener("pointerup", this._onPointerUp);
		this.container.addEventListener("pointercancel", this._onPointerUp);
	}

	private _barAt(event: PointerEvent, rect: DOMRect): number {
		const barWidth: number = this._doc.getBarWidth();
		return Math.max(0, Math.min(this._doc.song.barCount - 1, Math.floor((event.clientX - rect.left) / barWidth)));
	}

	// The top of a row is full volume and the bottom is silence.
	private _levelAt(event: PointerEvent, rect: DOMRect): number {
		const inset: number = MixerEditor._inset;
		const rowTop: number = ChannelRow.patternHeight * this._dragChannel;
		const y: number = (event.clientY - rect.top - rowTop - inset) / (ChannelRow.patternHeight - inset * 2);
		return Math.max(0, Math.min(Config.measureVolumeMax, Math.round((1 - y) * Config.measureVolumeMax)));
	}

	private _paint(bar: number, level: number): void {
		const old: number = this._doc.song.getBarVolume(this._dragChannel, bar);
		if (old == level || this._group == null) return;
		this._group.append(new ChangeMeasureVolume(this._doc, this._dragChannel, bar, old, level));
		this._doc.setProspectiveChange(this._group);
	}

	private _onPointerDown = (event: PointerEvent): void => {
		if (event.button != 0) return;
		const rect: DOMRect = this.container.getBoundingClientRect();
		const channel: number = Math.floor((event.clientY - rect.top) / ChannelRow.patternHeight);
		if (channel < 0 || channel >= this._doc.song.getChannelCount()) return;
		this.container.setPointerCapture(event.pointerId);
		this._dragChannel = channel;
		this._dragBar = this._barAt(event, rect);
		this._group = new ChangeGroup();
		this._doc.selection.setChannelBar(channel, this._dragBar);
		this._paint(this._dragBar, this._levelAt(event, rect));
	}

	private _onPointerMove = (event: PointerEvent): void => {
		if (this._group == null) return;
		const rect: DOMRect = this.container.getBoundingClientRect();
		const bar: number = this._barAt(event, rect);
		const level: number = this._levelAt(event, rect);
		// A fast drag can jump several measures between events; fill the gap so
		// no measure in the sweep is skipped.
		const step: number = bar >= this._dragBar ? 1 : -1;
		for (let b: number = this._dragBar; b != bar + step; b += step) this._paint(b, level);
		this._dragBar = bar;
	}

	private _onPointerUp = (event: PointerEvent): void => {
		if (this._group == null) return;
		this._doc.record(<Change> this._group);
		this._group = null;
		this._dragChannel = -1;
		this._dragBar = -1;
	}

	public render(): void {
		const song = this._doc.song;
		const barWidth: number = this._doc.getBarWidth();
		const channelCount: number = song.getChannelCount();
		const inset: number = MixerEditor._inset;
		const fullHeight: number = ChannelRow.patternHeight - inset * 2;

		// This runs on every song change, and the volumes are the only thing that
		// moves here, so skip the DOM work when nothing this view draws has changed.
		let signature: string = barWidth + "," + song.barCount + "," + channelCount + "," + song.pitchChannelCount + "," + this._doc.channel + "," + this._doc.bar + ";";
		for (let c: number = 0; c < channelCount; c++) {
			signature += (song.channels[c].muted ? "m" : "") + ":";
			for (let b: number = 0; b < song.barCount; b++) signature += song.getBarVolume(c, b);
			signature += ";";
		}
		if (signature == this._renderedSignature) return;
		this._renderedSignature = signature;

		const width: number = barWidth * song.barCount;
		this.container.style.width = width + "px";
		this.container.style.height = (channelCount * ChannelRow.patternHeight) + "px";
		this._svg.setAttribute("width", String(width));
		this._svg.setAttribute("height", String(channelCount * ChannelRow.patternHeight));

		for (let c: number = this._cells.length; c < channelCount; c++) this._cells[c] = [];
		for (let c: number = channelCount; c < this._cells.length; c++) {
			for (const cell of this._cells[c]) { cell.back.remove(); cell.fill.remove(); }
		}
		this._cells.length = channelCount;

		for (let c: number = 0; c < channelCount; c++) {
			const colors: ChannelColors = ColorConfig.getChannelColor(song, c);
			const row: Cell[] = this._cells[c];
			for (let b: number = song.barCount; b < row.length; b++) { row[b].back.remove(); row[b].fill.remove(); }
			row.length = song.barCount;
			for (let b: number = 0; b < song.barCount; b++) {
				if (row[b] == undefined) {
					const back: SVGRectElement = SVG.rect({rx: 3, "pointer-events": "none"});
					const fill: SVGRectElement = SVG.rect({rx: 3, "pointer-events": "none"});
					this._svg.insertBefore(back, this._selection);
					this._svg.insertBefore(fill, this._selection);
					row[b] = {back, fill};
				}
				const level: number = song.getBarVolume(c, b);
				const height: number = fullHeight * level / Config.measureVolumeMax;
				const x: number = barWidth * b + inset;
				const top: number = ChannelRow.patternHeight * c + inset;
				const {back, fill} = row[b];
				back.setAttribute("x", String(x));
				back.setAttribute("y", String(top));
				back.setAttribute("width", String(barWidth - inset * 2));
				back.setAttribute("height", String(fullHeight));
				back.setAttribute("fill", ColorConfig.uiWidgetBackground);
				fill.setAttribute("x", String(x));
				fill.setAttribute("y", String(top + fullHeight - height));
				fill.setAttribute("width", String(barWidth - inset * 2));
				fill.setAttribute("height", String(height));
				fill.setAttribute("fill", colors.primaryChannel);
				fill.setAttribute("opacity", song.channels[c].muted ? "0.3" : "1");
			}
		}

		this._selection.setAttribute("x", String(this._doc.bar * barWidth + 1));
		this._selection.setAttribute("y", String(this._doc.channel * ChannelRow.patternHeight + 1));
		this._selection.setAttribute("width", String(barWidth - 2));
		this._selection.setAttribute("height", String(ChannelRow.patternHeight - 2));
	}
}
