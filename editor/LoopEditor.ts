// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {ColorConfig} from "./ColorConfig.js";
import {SongDocument} from "./SongDocument.js";
import {HTML, SVG} from "imperative-html/dist/esm/elements-strict.js";
//import {EasyPointers} from "./EasyPointers.js";
import {ChangeLoop, ChangeChannelBar, ChangeRepeatSections} from "./changes.js";
import {RepeatSection, getRepeatSectionDepth, sanitizeRepeatSections} from "../synth/synth.js";

/*
Unfortunately, I ran into a bug on iOS when I tried to update this component to
use EasyPointers. Vertical dragging cancels all events as expected to allow for
scrolling, but horizontal dragging cancels mouse and pointer events without
cancelling touch events. This seems to be because the loop editor is inside a
horizontally scrollable container, despite the fact that the widget has
"touch-action: pan-y" and no scrolling actually occurs. If I want to support
horizontal dragging, I either have to use touch events or move the loop editor
outside of a horizontally scrollable container. I considered moving it outside
the scrollable container (the track and mute editor container) and listening for
scroll events to realign the editors, but that would complicate the positioning
of the horizontal browser scroll bars (visible in fullscreen layouts). For the
time being, I'm keeping the old touch events implementation, but I've added a
commented-out EasyPointers implementation as well. Hopefully one day I'll be
able to remove the mouse and touch event implementations.
*/

interface Cursor {
	startBar: number;
	mode: number;
}

interface Endpoints {
	start: number;
	length: number;
}

export class LoopEditor {
	// The playback loop keeps the original 20px strip; repeat sections get
	// their own lane underneath so the two never fight for the same pixels.
	private readonly _loopHeight: number = 20;
	// Each nesting level gets its own row of loop bars beneath the playback
	// loop, and the widget only grows as deep as the song actually nests.
	private readonly _repeatRowHeight: number = 18;
	private _editorHeight: number = 20;
	private readonly _maxRepeatCount: number = 8;
	private readonly _startMode:   number = 0;
	private readonly _endMode:     number = 1;
	private readonly _bothMode:    number = 2;

	private readonly _loop: SVGPathElement = SVG.path({fill: "none", stroke: ColorConfig.loopAccent, "stroke-width": 4});
	private readonly _highlight: SVGPathElement = SVG.path({fill: ColorConfig.hoverPreview, "pointer-events": "none"});
	private readonly _repeatGroup: SVGGElement = SVG.g();

	private readonly _svg: SVGSVGElement = SVG.svg({style: "position: absolute;", height: this._editorHeight},
		this._loop,
		this._repeatGroup,
		this._highlight,
	);
	
	public readonly container: HTMLElement = HTML.div({class: "loopEditor", style: "touch-action: pan-y;"}, this._svg);
	
	//private readonly _pointers: EasyPointers = new EasyPointers(this.container);
	
	private _barWidth: number = 32;
	private _change: ChangeLoop | null = null;
	private _cursor: Cursor = {startBar: -1, mode: -1};
	
	// The following properties are only necessary because of the ios pointer events bug.
	private _mouseX: number = 0;
	private _mouseY: number = 0;
	private _clientStartX: number = 0;
	private _clientStartY: number = 0;
	private _startedScrolling: boolean = false;
	private _draggingHorizontally: boolean = false;
	private _mouseDown: boolean = false;
	private _mouseOver: boolean = false;
	
	private _draggingRepeat: boolean = false;
	private _repeatDragStartBar: number = -1;
	private _repeatDragStartRow: number = 0;
	private _repeatDragDeleting: boolean = false;
	private _repeatDragMoved: boolean = false;
	private _repeatDragIndex: number = -1;
	private _repeatDragMode: number = -1;
	private _repeatSnapshot: RepeatSection[] = [];
	private _repeatChange: ChangeRepeatSections | null = null;
	private _renderedRepeatSignature: string = "";

	private _renderedLoopStart: number = -1;
	private _renderedLoopStop: number = -1;
	private _renderedBarCount: number = 0;
	private _renderedBarWidth: number = -1;
	
	constructor(private _doc: SongDocument) {
		this._updateCursorStatus();
		this._render();
		this._doc.notifier.watch(this._documentChanged);
		
		this.container.addEventListener("mousedown", this._whenMousePressed);
		this.container.addEventListener("contextmenu", this._whenContextMenu);
		document.addEventListener("mousemove", this._whenMouseMoved);
		document.addEventListener("mouseup", this._whenCursorReleased);
		this.container.addEventListener("mouseover", this._whenMouseOver);
		this.container.addEventListener("mouseout", this._whenMouseOut);
		
		this.container.addEventListener("touchstart", this._whenTouchPressed);
		this.container.addEventListener("touchmove", this._whenTouchMoved);
		this.container.addEventListener("touchend", this._whenTouchReleased);
		this.container.addEventListener("touchcancel", this._whenTouchReleased);
		
		//this.container.addEventListener("pointerenter", this._onPointerMove);
		//this.container.addEventListener("pointerleave", this._onPointerLeave);
		//this.container.addEventListener("pointerdown", this._onPointerDown);
		//this.container.addEventListener("pointermove", this._onPointerMove);
		//this.container.addEventListener("pointerup", this._onPointerUp);
		//this.container.addEventListener("pointercancel", this._onPointerUp);
	}
	
	private _getPointerBarPos(): number {
		return this._mouseX / this._barWidth;
		//return this._pointers.latest.getPointIn(this.container).x / this._barWidth;
	}
	
	private _updateCursorStatus(): void {
		const bar: number = this._getPointerBarPos();
		this._cursor.startBar = bar;
		
		if (bar > this._doc.song.loopStart - 0.25 && bar < this._doc.song.loopStart + this._doc.song.loopLength + 0.25) {
			if (bar - this._doc.song.loopStart < this._doc.song.loopLength * 0.5) {
				this._cursor.mode = this._startMode;
			} else {
				this._cursor.mode = this._endMode;
			}
		} else {
			this._cursor.mode = this._bothMode;
		}
	}
	
	private _isInRepeatLane(): boolean {
		return this._mouseY >= this._loopHeight;
	}

	private _getPointerRepeatRow(): number {
		return Math.floor((this._mouseY - this._loopHeight) / this._repeatRowHeight);
	}

	// Only the loop actually drawn on this row counts. Falling back to the
	// nearest enclosing loop meant that dragging across the empty row beneath
	// one grabbed it instead of starting a nested loop inside it, which made
	// nesting impossible to create by hand.
	private _findSectionIndexAtBar(bar: number, row: number): number {
		const sections: RepeatSection[] = this._doc.song.repeatSections;
		for (let i: number = 0; i < sections.length; i++) {
			if (!sections[i].containsBar(bar)) continue;
			if (getRepeatSectionDepth(sections, i) == row) return i;
		}
		return -1;
	}

	// Which part of a loop the pointer grabbed. The outer third of a short loop
	// resizes it and the middle moves it, same division the playback loop uses.
	private _findRepeatGrabMode(section: RepeatSection, bar: number): number {
		const edge: number = Math.min(0.35, section.length / 3);
		if (bar - section.start < edge) return this._startMode;
		if (section.end - bar < edge) return this._endMode;
		return this._bothMode;
	}

	private _beginRepeatDrag(): void {
		this._draggingRepeat = true;
		this._repeatDragStartBar = this._getPointerBarPos();
		this._repeatDragStartRow = this._getPointerRepeatRow();
		this._repeatDragMoved = false;
		this._repeatSnapshot = this._doc.song.repeatSections.map(s => s.copy());
		this._repeatDragIndex = this._findSectionIndexAtBar(Math.floor(this._repeatDragStartBar), this._repeatDragStartRow);
		this._repeatDragMode = this._repeatDragIndex == -1
			? this._bothMode
			: this._findRepeatGrabMode(this._repeatSnapshot[this._repeatDragIndex], this._repeatDragStartBar);
	}

	// Recomputed from the snapshot on every pointer move rather than applied
	// incrementally, so a drag that wanders over an illegal position and back
	// lands exactly where the pointer says.
	private _updateRepeatDrag(): void {
		const song = this._doc.song;
		const delta: number = Math.round(this._getPointerBarPos() - this._repeatDragStartBar);
		if (delta != 0) this._repeatDragMoved = true;

		const sections: RepeatSection[] = this._repeatSnapshot.map(s => s.copy());

		if (this._repeatDragIndex == -1) {
			if (this._repeatDragDeleting) return;
			const startBar: number = Math.floor(this._repeatDragStartBar);
			const endBar: number = Math.floor(this._getPointerBarPos());
			const low: number = Math.max(0, Math.min(startBar, endBar));
			const high: number = Math.min(song.barCount - 1, Math.max(startBar, endBar));
			if (high < low) return;
			sections.push(new RepeatSection(low, high - low + 1, 1));
		} else {
			const original: RepeatSection = this._repeatSnapshot[this._repeatDragIndex];
			const moved: RepeatSection = sections[this._repeatDragIndex];
			if (this._repeatDragMode == this._startMode) {
				const newStart: number = Math.max(0, Math.min(original.end - 1, original.start + delta));
				moved.start = newStart;
				moved.length = original.end - newStart;
			} else if (this._repeatDragMode == this._endMode) {
				const newEnd: number = Math.min(song.barCount, Math.max(original.start + 1, original.end + delta));
				moved.length = newEnd - original.start;
			} else {
				moved.start = Math.max(0, Math.min(song.barCount - original.length, original.start + delta));
			}
		}

		// Refuse a position that would partially overlap another loop instead
		// of letting sanitize silently delete the one being dragged.
		if (sanitizeRepeatSections(sections, song.barCount).length != sections.length) return;

		this._repeatChange = new ChangeRepeatSections(this._doc, this._repeatSnapshot, sections);
		this._doc.setProspectiveChange(this._repeatChange);
	}

	private _commitRepeatDrag(): void {
		// A grab that never moved is a click: cycle the repeat count, or delete.
		if (this._repeatDragIndex != -1 && !this._repeatDragMoved) {
			const sections: RepeatSection[] = this._repeatSnapshot.map(s => s.copy());
			if (this._repeatDragDeleting) {
				sections.splice(this._repeatDragIndex, 1);
			} else {
				const section: RepeatSection = sections[this._repeatDragIndex];
				section.repeatCount = section.repeatCount >= this._maxRepeatCount ? 1 : section.repeatCount + 1;
			}
			this._doc.record(new ChangeRepeatSections(this._doc, this._repeatSnapshot, sections));
			return;
		}

		if (this._repeatChange != null) this._doc.record(this._repeatChange);
	}

	private _findEndPoints(middle: number): Endpoints {
		let start: number = Math.round(middle - this._doc.song.loopLength / 2);
		let end: number = start + this._doc.song.loopLength;
		if (start < 0) {
			end -= start;
			start = 0;
		}
		if (end > this._doc.song.barCount) {
			start -= end - this._doc.song.barCount;
			end = this._doc.song.barCount;
		}
		return {start: start, length: end - start};
	}
	
	private _whenMouseOver = (event: MouseEvent): void => {
		if (this._mouseOver) return;
		this._mouseOver = true;
		this._updatePreview();
	}
	
	private _whenMouseOut = (event: MouseEvent): void => {
		if (!this._mouseOver) return;
		this._mouseOver = false;
		this._updatePreview();
	}
	
	//private _onPointerLeave = (event: PointerEvent): void => {
	//	this._updatePreview();
	//}
	
	private _whenMousePressed = (event: MouseEvent): void => {
		event.preventDefault();
		this._mouseDown = true;
		const boundingRect: ClientRect = this._svg.getBoundingClientRect();
		this._mouseX = (event.clientX || event.pageX) - boundingRect.left;
		this._mouseY = (event.clientY || event.pageY) - boundingRect.top;

		if (this._isInRepeatLane()) {
			this._repeatDragDeleting = event.altKey || event.button == 2;
			this._beginRepeatDrag();
			this._updatePreview();
			return;
		}

		this._updateCursorStatus();
		this._updatePreview();
		this._whenMouseMoved(event);
	}

	private _whenContextMenu = (event: MouseEvent): void => {
		const boundingRect: ClientRect = this._svg.getBoundingClientRect();
		this._mouseY = (event.clientY || event.pageY) - boundingRect.top;
		if (this._isInRepeatLane()) event.preventDefault();
	}

	private _whenTouchPressed = (event: TouchEvent): void => {
		this._mouseDown = true;
		const boundingRect: ClientRect = this._svg.getBoundingClientRect();
		this._mouseX = event.touches[0].clientX - boundingRect.left;
		this._mouseY = event.touches[0].clientY - boundingRect.top;

		if (this._isInRepeatLane()) {
			this._repeatDragDeleting = false;
			this._beginRepeatDrag();
			this._clientStartX = event.touches[0].clientX;
			this._clientStartY = event.touches[0].clientY;
			this._draggingHorizontally = false;
			this._startedScrolling = false;
			return;
		}

		this._updateCursorStatus();
		this._updatePreview();
		this._clientStartX = event.touches[0].clientX;
		this._clientStartY = event.touches[0].clientY;
		this._draggingHorizontally = false;
		this._startedScrolling = false;
	}
	
	//private _onPointerDown = (event: PointerEvent): void => {
	//	this._updateCursorStatus();
	//	this._onPointerMove(event);
	//	this._updatePreview();
	//}
	
	private _whenMouseMoved = (event: MouseEvent): void => {
		const boundingRect: ClientRect = this._svg.getBoundingClientRect();
		this._mouseX = (event.clientX || event.pageX) - boundingRect.left;
		if (!this._mouseDown) this._mouseY = (event.clientY || event.pageY) - boundingRect.top;
		this._whenCursorMoved();
	}
	
	private _whenTouchMoved = (event: TouchEvent): void => {
		if (!this._mouseDown) return;
		const boundingRect: ClientRect = this._svg.getBoundingClientRect();
		this._mouseX = event.touches[0].clientX - boundingRect.left;
		
		if (!this._draggingHorizontally && !this._startedScrolling) {
			if (Math.abs(event.touches[0].clientY - this._clientStartY) > 10) {
				this._startedScrolling = true;
			} else if (Math.abs(event.touches[0].clientX - this._clientStartX) > 10) {
				this._draggingHorizontally = true;
			}
		}
		
		if (this._draggingHorizontally) {
			this._whenCursorMoved();
			event.preventDefault();
		}
	}
	
	//private _onPointerMove = (event: PointerEvent): void => {
	//	this._whenCursorMoved();
	//}
	
	private _whenCursorMoved(): void {
		if (this._draggingRepeat) {
			if (this._mouseDown) this._updateRepeatDrag();
			this._updatePreview();
			return;
		}
		if (this._mouseDown) {
		//if (event.pointer!.isDown) {
			let oldStart: number = this._doc.song.loopStart;
			let oldEnd: number = this._doc.song.loopStart + this._doc.song.loopLength;
			if (this._change != null && this._doc.lastChangeWas(this._change)) {
				oldStart = this._change.oldStart;
				oldEnd = oldStart + this._change.oldLength;
			}
			
			const bar: number = this._getPointerBarPos();
			let start: number;
			let end: number;
			let temp: number;
			if (this._cursor.mode == this._startMode) {
				start = oldStart + Math.round(bar - this._cursor.startBar);
				end = oldEnd;
				if (start < 0) start = 0;
				if (start >= this._doc.song.barCount) start = this._doc.song.barCount;
				if (start == end) {
					start = end - 1;
				} else if (start > end) {
					temp = start;
					start = end;
					end = temp;
				}
				this._change = new ChangeLoop(this._doc, oldStart, oldEnd - oldStart, start, end - start);
			} else if (this._cursor.mode == this._endMode) {
				start = oldStart;
				end = oldEnd + Math.round(bar - this._cursor.startBar);
				if (end < 0) end = 0;
				if (end >= this._doc.song.barCount) end = this._doc.song.barCount;
				if (end == start) {
					end = start + 1;
				} else if (end < start) {
					temp = start;
					start = end;
					end = temp;
				}
				this._change = new ChangeLoop(this._doc, oldStart, oldEnd - oldStart, start, end - start);
			} else if (this._cursor.mode == this._bothMode) {
				const endPoints: Endpoints = this._findEndPoints(bar);
				this._change = new ChangeLoop(this._doc, oldStart, oldEnd - oldStart, endPoints.start, endPoints.length);
			}
			this._doc.synth.jumpIntoLoop();
			if (this._doc.prefs.autoFollow) {
				new ChangeChannelBar(this._doc, this._doc.channel, Math.floor(this._doc.synth.playhead), true);
			}
			this._doc.setProspectiveChange(this._change);
		} else {
			// The pointer is not down, just update the cursor.
			this._updateCursorStatus();
			this._updatePreview();
		}
	}
	
	private _whenTouchReleased = (event: TouchEvent): void => {
		event.preventDefault();
		if (!this._startedScrolling) {
			this._whenCursorMoved();
			this._mouseOver = false;
			this._whenCursorReleased(event);
			this._updatePreview();
		}
		this._mouseDown = false;
	}
	
	private _whenCursorReleased = (event: Event): void => {
		if (this._draggingRepeat) {
			this._commitRepeatDrag();
			this._draggingRepeat = false;
			this._repeatDragStartBar = -1;
			this._repeatDragIndex = -1;
			this._repeatChange = null;
			this._mouseDown = false;
			this._render();
			return;
		}
		if (this._change != null) this._doc.record(this._change);
		this._change = null;
		this._mouseDown = false;
		this._updateCursorStatus();
		this._render();
	}
	
	//private _onPointerUp = (event: PointerEvent): void => {
	//	if (this._change != null) this._doc.record(this._change);
	//	this._change = null;
	//	this._updateCursorStatus();
	//	this._render();
	//}
	
	private _updatePreview(): void {
		// The highlight belongs to the playback loop, so it would be misleading
		// over the repeat rows; those get a cursor hint instead.
		if (this._mouseOver && this._isInRepeatLane()) {
			this._highlight.style.display = "none";
			this._updateRepeatCursor();
			return;
		}
		this.container.style.cursor = "";

		const showHighlight: boolean = this._mouseOver && !this._mouseDown;
		//const showHighlight: boolean = this._pointers.latest.isHovering;
		this._highlight.style.display = showHighlight ? "" : "none";
		
		if (showHighlight) {
			const radius: number = this._loopHeight / 2;

			let highlightStart: number = (this._doc.song.loopStart) * this._barWidth;
			let highlightStop: number = (this._doc.song.loopStart + this._doc.song.loopLength) * this._barWidth;
			if (this._cursor.mode == this._startMode) {
				highlightStop = (this._doc.song.loopStart) * this._barWidth + radius * 2;
			} else if (this._cursor.mode == this._endMode) {
				highlightStart = (this._doc.song.loopStart + this._doc.song.loopLength) * this._barWidth - radius * 2;
			} else {
				const endPoints: Endpoints = this._findEndPoints(this._cursor.startBar);
				highlightStart = (endPoints.start) * this._barWidth;
				highlightStop = (endPoints.start + endPoints.length) * this._barWidth;
			}
			
			this._highlight.setAttribute("d",
				`M ${highlightStart + radius} ${4} ` +
				`L ${highlightStop - radius} ${4} ` +
				`A ${radius - 4} ${radius - 4} ${0} ${0} ${1} ${highlightStop - radius} ${this._loopHeight - 4} ` +
				`L ${highlightStart + radius} ${this._loopHeight - 4} ` +
				`A ${radius - 4} ${radius - 4} ${0} ${0} ${1} ${highlightStart + radius} ${4} ` +
				`z`
			);
		}
	}
	
	private _updateRepeatCursor(): void {
		const bar: number = this._getPointerBarPos();
		const index: number = this._findSectionIndexAtBar(Math.floor(bar), this._getPointerRepeatRow());
		if (index == -1) {
			this.container.style.cursor = "copy";
			return;
		}
		const mode: number = this._findRepeatGrabMode(this._doc.song.repeatSections[index], bar);
		this.container.style.cursor = mode == this._bothMode ? "grab" : "ew-resize";
	}

	private _documentChanged = (): void => {
		this._render();
	}
	
	private _render(): void {
		this._barWidth = this._doc.getBarWidth();
		this._updateEditorHeight();

		const radius: number = this._loopHeight / 2;
		const loopStart: number = (this._doc.song.loopStart) * this._barWidth;
		const loopStop: number = (this._doc.song.loopStart + this._doc.song.loopLength) * this._barWidth;
		
		if (this._renderedBarCount != this._doc.song.barCount || this._renderedBarWidth != this._barWidth) {
			this._renderedBarCount = this._doc.song.barCount;
			this._renderedBarWidth = this._barWidth;
			const editorWidth = this._barWidth * this._doc.song.barCount;
			this.container.style.width = editorWidth + "px";
			this._svg.setAttribute("width", editorWidth + "");
		}

		if (this._renderedLoopStart != loopStart || this._renderedLoopStop != loopStop) {
			this._renderedLoopStart = loopStart;
			this._renderedLoopStop = loopStop;
			this._loop.setAttribute("d",
				`M ${loopStart + radius} ${2} ` +
				`L ${loopStop - radius} ${2} ` +
				`A ${radius - 2} ${radius - 2} ${0} ${0} ${1} ${loopStop - radius} ${this._loopHeight - 2} ` +
				`L ${loopStart + radius} ${this._loopHeight - 2} ` +
				`A ${radius - 2} ${radius - 2} ${0} ${0} ${1} ${loopStart + radius} ${2} ` +
				`z`
			);
		}
		
		this._renderRepeatSections();
		this._updatePreview();
	}

	private _updateEditorHeight(): void {
		const sections: RepeatSection[] = this._doc.song.repeatSections;
		let rows: number = 0;
		for (let i: number = 0; i < sections.length; i++) {
			rows = Math.max(rows, getRepeatSectionDepth(sections, i) + 1);
		}
		// Always keep one spare row below the deepest loop. Sizing to just the
		// rows in use left nowhere to drag, so a nested loop could never be
		// started once the first loop existed.
		const height: number = this._loopHeight + (rows + 1) * this._repeatRowHeight;
		if (height == this._editorHeight) return;
		this._editorHeight = height;
		this._svg.setAttribute("height", height + "");
		this.container.style.height = height + "px";
	}

	private _renderRepeatSections(): void {
		const sections: RepeatSection[] = this._doc.song.repeatSections;
		const signature: string = sections.map((s, i) =>
			`${s.start}/${s.length}/${s.repeatCount}/${getRepeatSectionDepth(sections, i)}`).join(" ") + `@${this._barWidth}`;
		if (signature == this._renderedRepeatSignature) return;
		this._renderedRepeatSignature = signature;

		while (this._repeatGroup.firstChild != null) this._repeatGroup.removeChild(this._repeatGroup.firstChild);

		for (let i: number = 0; i < sections.length; i++) {
			const section: RepeatSection = sections[i];
			const depth: number = getRepeatSectionDepth(sections, i);
			const color: string = ColorConfig.getRepeatSectionColor(depth);
			const left: number = section.start * this._barWidth;
			const width: number = section.length * this._barWidth;
			const top: number = this._loopHeight + depth * this._repeatRowHeight + 2;
			const height: number = this._repeatRowHeight - 4;

			// The same pill the playback loop uses, just in its own colour, so
			// a repeat reads as another loop bar rather than a different kind
			// of thing.
			this._repeatGroup.appendChild(SVG.rect({
				x: left + 2,
				y: top,
				width: Math.max(1, width - 4),
				height: height,
				rx: height / 2,
				ry: height / 2,
				fill: "none",
				stroke: color,
				"stroke-width": 4,
			}));

			if (width >= 40) {
				this._repeatGroup.appendChild(SVG.text({
					x: left + width / 2,
					y: top + height / 2 + 4,
					fill: color,
					"text-anchor": "middle",
					"font-size": "11px",
					"font-weight": "bold",
					"pointer-events": "none",
				}, `×${section.repeatCount + 1}`));
			}
		}
	}
}
