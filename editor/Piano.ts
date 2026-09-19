// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {Config} from "../synth/SynthConfig.js";
import {EditorConfig} from "./EditorConfig.js";
import {ColorConfig} from "./ColorConfig.js";
import {SongDocument} from "./SongDocument.js";
import {HTML} from "imperative-html/dist/esm/elements-strict.js";
import {EasyPointers} from "./EasyPointers.js";

export class Piano {
	private readonly _pianoContainer: HTMLDivElement = HTML.div({style: "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;"});
	private readonly _drumContainer: HTMLDivElement = HTML.div({style: "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;"});
	private readonly _preview: HTMLDivElement = HTML.div({style: `width: 100%; height: 40px; border: 2px solid ${ColorConfig.primaryText}; position: absolute; box-sizing: border-box; pointer-events: none;`});
	public readonly container: HTMLDivElement = HTML.div({style: "width: 56px; height: 100%; overflow: hidden; position: relative; flex-shrink: 0; touch-action: none;"},
		this._pianoContainer,
		this._drumContainer,
		this._preview,
	);
	
	private readonly _pointers: EasyPointers = new EasyPointers(this.container, {preventTouchGestureScrolling: true});
	
	private readonly _editorHeight: number = 481;
	private readonly _pianoKeys: HTMLDivElement[] = [];
	private readonly _pianoLabels: HTMLDivElement[] = [];
	private readonly _partLabels: HTMLDivElement[] = [];
	// Written keys that are conventionally spelled with sharps. An Eb alto part
	// in concert Bb is written in G major, where the raised note is F♯, not G♭.
	private static readonly _sharpKeys: ReadonlyArray<number> = [7, 2, 9, 4, 11, 6];
	private static readonly _sharpNames: ReadonlyArray<string> = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
	private _renderedPart: number = -1;
	private _renderedOutsideScale: boolean = false;
	
	private _pitchHeight: number;
	private _pitchCount: number;
	private _cursorPitch: number;
	private _playedPitch: number = -1;
	private _renderedScale: number = -1;
	private _renderedDrums: boolean = false;
	private _renderedKey: number = -1;
	private _renderedPitchCount: number = -1;
	private readonly _renderedLiveInputPitches: number[] = [];
	
	constructor(private _doc: SongDocument) {
		for (let i: number = 0; i < Config.drumCount; i++) {
			const scale: number = (1.0 - (i / Config.drumCount) * 0.35) * 100;
			this._drumContainer.appendChild(HTML.div({class: "drum-button", style: `background-size: ${scale}% ${scale}%;`}));
		}
		
		this.container.addEventListener("pointerenter", this._onPointerMove);
		this.container.addEventListener("pointerleave", this._onPointerLeave);
		this.container.addEventListener("pointerdown", this._onPointerDown);
		this.container.addEventListener("pointermove", this._onPointerMove);
		this.container.addEventListener("pointerup", this._onPointerUp);
		this.container.addEventListener("pointercancel", this._onPointerUp);
		
		this._doc.notifier.watch(this._documentChanged);
		this._documentChanged();
		
		window.requestAnimationFrame(this._onAnimationFrame);
	}
	
	private _updateCursorPitch(): void {
		const scale: ReadonlyArray<boolean> = Config.scales[this._doc.song.scale].flags;
		const mouseY: number = this._pointers.latest.getPointInNormalized(this.container).y || 0;
		
		const mousePitch: number = Math.max(0, Math.min(this._pitchCount-1, (1 - mouseY) * this._pitchCount));
		if (scale[Math.floor(mousePitch) % Config.pitchesPerOctave] || this._doc.song.getChannelIsNoise(this._doc.channel)) {
			this._cursorPitch = Math.floor(mousePitch);
		} else {
			let topPitch: number = Math.floor(mousePitch) + 1;
			let bottomPitch: number = Math.floor(mousePitch) - 1;
			while (!scale[topPitch % Config.pitchesPerOctave]) {
				topPitch++;
			}
			while (!scale[(bottomPitch) % Config.pitchesPerOctave]) {
				bottomPitch--;
			}
			let topRange: number = topPitch;
			let bottomRange: number = bottomPitch + 1;
			if (topPitch % Config.pitchesPerOctave == 0 || topPitch % Config.pitchesPerOctave == 7) {
				topRange -= 0.5;
			}
			if (bottomPitch % Config.pitchesPerOctave == 0 || bottomPitch % Config.pitchesPerOctave == 7) {
				bottomRange += 0.5;
			}
			this._cursorPitch = mousePitch - bottomRange > topRange - mousePitch ? topPitch : bottomPitch;
		}
	}
	
	private _playLiveInput(): void {
		const octaveOffset: number = this._doc.getBaseVisibleOctave(this._doc.channel) * Config.pitchesPerOctave;
		const currentPitch: number = this._cursorPitch + octaveOffset;
		if (this._playedPitch == currentPitch) return;
		this._doc.performance.removePerformedPitch(this._playedPitch);
		this._playedPitch = currentPitch;
		this._doc.performance.addPerformedPitch(currentPitch);
	}
	
	private _releaseLiveInput(): void {
		this._doc.performance.removePerformedPitch(this._playedPitch);
		this._playedPitch = -1;
	}
	
	private _onPointerLeave = (event: PointerEvent): void => {
		this._updatePreview();
	}
	
	private _onPointerDown = (event: PointerEvent): void => {
		this._doc.synth.maintainLiveInput();
		this._updateCursorPitch();
		this._playLiveInput();
		this._updatePreview();
	}
	
	private _onPointerMove = (event: PointerEvent): void => {
		this._doc.synth.maintainLiveInput();
		this._updateCursorPitch();
		if (event.pointer!.isDown) this._playLiveInput();
		this._updatePreview();
	}
	
	private _onPointerUp = (event: PointerEvent): void => {
		this._releaseLiveInput();
		this._updatePreview();
	}
	
	private _onAnimationFrame = (): void => {
		window.requestAnimationFrame(this._onAnimationFrame);
		
		let liveInputChanged: boolean = false;
		const liveInputPitchCount: number = !this._doc.performance.pitchesAreTemporary() ? this._doc.synth.liveInputPitches.length : 0;
		if (this._renderedLiveInputPitches.length != liveInputPitchCount) {
			liveInputChanged = true;
		}
		for (let i: number = 0; i < liveInputPitchCount; i++) {
			if (this._renderedLiveInputPitches[i] != this._doc.synth.liveInputPitches[i]) {
				this._renderedLiveInputPitches[i] = this._doc.synth.liveInputPitches[i];
				liveInputChanged = true;
			}
		}
		this._renderedLiveInputPitches.length = liveInputPitchCount;
		
		if (liveInputChanged) {
			this._updatePreview();
		}
	}
	
	private _updatePreview(): void {
		const previewIsVisible = this._pointers.latest.isHovering;
		this._preview.style.display = previewIsVisible ? "" : "none";
		if (previewIsVisible) {
			const pitchHeight: number = this._pitchHeight / (this._editorHeight / this.container.clientHeight);
			
			this._preview.style.left = "0px";
			this._preview.style.top = pitchHeight * (this._pitchCount - this._cursorPitch - 1) + "px";
			this._preview.style.height = pitchHeight + "px";
		}
		
		const octaveOffset: number = this._doc.getBaseVisibleOctave(this._doc.channel) * Config.pitchesPerOctave;
		const container: HTMLDivElement = this._doc.song.getChannelIsNoise(this._doc.channel) ? this._drumContainer : this._pianoContainer;
		const children: HTMLCollection = container.children;
		for (let i: number = 0; i < children.length; i++) {
			const child: Element = children[i];
			if (this._renderedLiveInputPitches.indexOf(i + octaveOffset) == -1) {
				child.classList.remove("pressed");
			} else {
				child.classList.add("pressed");
			}
		}
	}
	
	private _documentChanged = (): void => {
		const isDrum: boolean = this._doc.song.getChannelIsNoise(this._doc.channel);
		this._pitchCount = isDrum ? Config.drumCount : this._doc.getVisiblePitchCount();
		this._pitchHeight = this._editorHeight / this._pitchCount;
		this._updateCursorPitch();
		if (this._pointers.latest.isDown) this._playLiveInput();
		
		if (!this._doc.prefs.showLetters) return;
		if (this._renderedScale == this._doc.song.scale && this._renderedKey == this._doc.song.key && this._renderedDrums == isDrum && this._renderedPitchCount == this._pitchCount && this._renderedPart == this._doc.prefs.transposingPart && this._renderedOutsideScale == this._doc.prefs.notesOutsideScale) return;
		
		this._renderedScale = this._doc.song.scale;
		this._renderedPart = this._doc.prefs.transposingPart;
		this._renderedOutsideScale = this._doc.prefs.notesOutsideScale;
		this._renderedKey = this._doc.song.key;
		this._renderedDrums = isDrum;
		
		this._pianoContainer.style.display = isDrum ? "none" : "flex";
		this._drumContainer.style.display = isDrum ? "flex" : "none";
		
		if (!isDrum) {
			if (this._renderedPitchCount != this._pitchCount) {
				this._pianoContainer.innerHTML = "";
				for (let i: number = 0; i < this._pitchCount; i++) {
					const pianoLabel: HTMLDivElement = HTML.div({class: "piano-label"});
					const partLabel: HTMLDivElement = HTML.div({class: "piano-part-label"});
					const pianoKey: HTMLDivElement = HTML.div({class: "piano-button", style: "background: gray;"}, pianoLabel, partLabel);
					this._pianoContainer.appendChild(pianoKey);
					this._pianoLabels[i] = pianoLabel;
					this._partLabels[i] = partLabel;
					this._pianoKeys[i] = pianoKey;
				}
				this._pianoLabels.length = this._pitchCount;
				this._partLabels.length = this._pitchCount;
				this._pianoKeys.length = this._pitchCount;
				this._renderedPitchCount = this._pitchCount;
			}
			
			for (let j: number = 0; j < this._pitchCount; j++) {
				const pitchNameIndex: number = (j + Config.keys[this._doc.song.key].basePitch) % Config.pitchesPerOctave;
				const isWhiteKey: boolean = Config.keys[pitchNameIndex].isWhiteKey;
				this._pianoKeys[j].style.background = isWhiteKey ? ColorConfig.whitePianoKey : ColorConfig.blackPianoKey;
				const inScale: boolean = Config.scales[this._doc.song.scale].flags[j % Config.pitchesPerOctave];
				// A note outside the scale still gets a name when it can be
				// played; hiding the name made usable keys look unavailable.
				const named: boolean = inScale || this._doc.prefs.notesOutsideScale;
				this._pianoKeys[j].classList.toggle("disabled", !inScale);
				this._pianoLabels[j].style.display = named ? "" : "none";
				this._partLabels[j].style.display = "none";

				if (named) {
					const textColor: string = Config.keys[pitchNameIndex].isWhiteKey ? "black" : "white";
					const label: HTMLDivElement = this._pianoLabels[j];
					label.style.color = textColor;
					label.textContent = Piano.getPitchName(pitchNameIndex, j);

					const part = EditorConfig.transposingParts[this._doc.prefs.transposingPart];
					if (part != undefined && part.semitones != 0) {
						const writtenIndex: number = (pitchNameIndex + part.semitones) % Config.pitchesPerOctave;
						const writtenKey: number = (this._doc.song.key + part.semitones) % Config.pitchesPerOctave;
						const useSharps: boolean = Piano._sharpKeys.indexOf(writtenKey) != -1;
						const partLabel: HTMLDivElement = this._partLabels[j];
						partLabel.style.display = "";
						partLabel.style.color = textColor;
						partLabel.textContent = useSharps
							? Piano._sharpNames[writtenIndex]
							: Piano.getPitchName(writtenIndex, writtenIndex);
					}
				}
			}
		}
		this._updatePreview();
	}
	
	public static getPitchName(pitchNameIndex: number, scaleIndex: number): string {
		let text: string;
		
		if (Config.keys[pitchNameIndex].isWhiteKey) {
			text = Config.keys[pitchNameIndex].name;
		} else {
			// Config.keys spells the black keys as flats, matching the concert
			// keys in the key menu. Deriving a name from the neighbouring white
			// key instead would print A♯ next to a label reading CONCERT B♭.
			text = Config.keys[pitchNameIndex].name;
		}
		
		return text;
	}
}
