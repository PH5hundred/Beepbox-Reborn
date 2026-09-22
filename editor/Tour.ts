// Copyright (c) 2012-2022 John Nesky and contributing authors, released under the MIT license.
// The guided tour is an addition of this fork; it is not part of upstream BeepBox.

import {ColorConfig} from "./ColorConfig.js";
import {HTML} from "imperative-html/dist/esm/elements-strict.js";

const {div, button, span, h2, p} = HTML;

interface TourStep {
	// Looked up when the step is shown, not when the tour is built, because much
	// of the instrument panel only exists for certain instrument types.
	readonly find: (root: HTMLElement) => HTMLElement | null;
	readonly title: string;
	readonly body: string;
}

// Finds a "Scale:" / "Tempo:" style row by its label, which survives the rows
// being reordered or hidden far better than an nth-child would.
function rowByLabel(root: HTMLElement, label: string): HTMLElement | null {
	const rows: NodeListOf<Element> = root.querySelectorAll(".selectRow");
	for (let i: number = 0; i < rows.length; i++) {
		const tip: Element | null = rows[i].querySelector(".tip");
		if (tip == null) continue;
		if (tip.textContent!.trim().replace(/:$/, "").toLowerCase() == label.toLowerCase()) {
			return <HTMLElement> rows[i];
		}
	}
	return null;
}

// Prefers a match that is actually on screen. The note grid in particular exists
// three times over - the faded previous and next patterns flank the real one -
// and the hidden copies come first in the document.
function bySelector(selector: string): (root: HTMLElement) => HTMLElement | null {
	return (root: HTMLElement) => {
		const matches: NodeListOf<Element> = root.querySelectorAll(selector);
		for (let i: number = 0; i < matches.length; i++) {
			const element: HTMLElement = <HTMLElement> matches[i];
			if (element.offsetWidth > 0 || element.offsetHeight > 0) return element;
		}
		return matches.length > 0 ? <HTMLElement> matches[0] : null;
	};
}

export const EDITOR_STEPS: TourStep[] = [
	{
		find: (root) => root,
		title: "Welcome to BeepBox: Reborn",
		body: "This is a fork of BeepBox, the music sketchpad made by John Nesky. This tour walks through every part of the editor. Use Next and Back, or the arrow keys, and press Esc whenever you want out.",
	},
	{
		find: bySelector(".playback-bar-controls"),
		title: "Playback controls",
		body: "Play and pause the song, record notes live from your keyboard, stop, and jump to the previous or next measure. Spacebar plays and pauses too, and shift-space plays from the start of the selection.",
	},
	{
		find: bySelector(".playback-volume-controls"),
		title: "Volume",
		body: "Overall output volume. This only affects what you hear — it is not saved into the song, and it does not change how loud an exported file is.",
	},
	{
		find: bySelector(".menu.file"),
		title: "File menu",
		body: "Start a new song, import and export (.mid, .json, .wav, .mp3), and copy a shareable link. A song is stored entirely in the page URL after the '#', so that link is the whole song — which also means a stray line break when copying will break it.",
	},
	{
		find: bySelector(".menu.edit"),
		title: "Edit menu",
		body: "Undo and redo, cut and paste patterns, transpose the selection up or down, and change how many measures or channels the song has. It also holds the operations these buttons do not cover, like inserting a measure in the middle rather than at the end.",
	},
	{
		find: bySelector(".menu.preferences"),
		title: "Preferences",
		body: "Layout, colour theme, note names on the piano, and the staff overlay that draws treble and bass lines behind the note grid. Several parts of the editor live here and are off until you switch them on: 'Enable Channel Muting' adds mute boxes beside the track, and 'Show Octave Scrollbar' adds a slider for moving the grid between octaves. Preferences are remembered in this browser and are not part of the song.",
	},
	{
		find: (root) => rowByLabel(root, "Scale"),
		title: "Scale",
		body: "Which notes are highlighted as 'in key' in the note grid. It is a guide, not a restriction — you can still place any note you like. Changing it never moves notes you have already written.",
	},
	{
		find: (root) => rowByLabel(root, "Key"),
		title: "Key",
		body: "The concert key of the song. Every pitch in BeepBox is stored as an offset from this key rather than as an absolute note, so changing the key transposes the whole song at once.",
	},
	{
		find: (root) => rowByLabel(root, "Time"),
		title: "Time signature",
		body: "Beats per measure on the left and the beat unit on the right, so 6/8 and cut time are both reachable. This sets how wide a measure is in the note grid and what the sheet music page writes at the front of the staff.",
	},
	{
		find: (root) => rowByLabel(root, "My part"),
		title: "My part",
		body: "Pick the instrument you personally read, and the piano on the left labels itself in that instrument's written pitch. An alto sax player sees G where the song sounds concert B♭. It changes the labels only — the song is untouched.",
	},
	{
		find: (root) => rowByLabel(root, "Tempo"),
		title: "Tempo",
		body: "Speed in beats per minute, by slider or by typing an exact number. The sheet music page prints whatever is set here.",
	},
	{
		find: (root) => rowByLabel(root, "Master vol"),
		title: "Master volume",
		body: "The volume of the whole song, saved with it. This is different from the volume slider by the play button, which only changes what you hear and is not part of the song.",
	},
	{
		find: bySelector(".measureVolumeRow"),
		title: "Measure volume",
		body: "The volume of one measure of one instrument. It follows whichever measure is selected in the track, so click a box and then drag this. That is how you write a swell or drop one part back under another, and the sheet music prints it as a dynamic marking - mf, f, ff and so on - wherever it changes.",
	},
	{
		find: (root) => rowByLabel(root, "Rhythm"),
		title: "Rhythm",
		body: "How finely the note grid is divided, and what notes snap to. Straight divisions give you eighths and sixteenths; the triplet settings swing the grid instead.",
	},
	{
		find: bySelector(".pianoContainer"),
		title: "The piano",
		body: "Names the pitch of every row in the grid, and plays a note when you click it. Black keys are spelled as flats here. If you set 'My part' above, a second column shows the note you would read on your own instrument.",
	},
	{
		find: bySelector(".patternEditorContainer"),
		title: "The note grid",
		body: "Where you actually write. Click to place a note, drag its ends to change how long it is, and drag it up or down to change pitch. Drag a note's middle for vibrato-style pitch bends, and add more notes at the same time for chords.",
	},
	{
		find: bySelector("#octaveScrollBarContainer"),
		title: "Octave scrollbar",
		body: "Slides the grid up and down the range of the instrument, since only part of it fits on screen at once. The zoom buttons beside it change how many rows are visible.",
	},
	{
		find: bySelector(".muteEditor"),
		title: "Mute and solo",
		body: "One box per channel. Click to mute a channel, so you can listen to a single part while you work on it. Muting is a listening aid and is not saved as part of the song.",
	},
	{
		find: bySelector(".trackRow"),
		title: "The track",
		body: "The map of the whole song: one row per instrument, one box per measure. The number in a box is which pattern plays there. Click the top half of a box to count up and the bottom half to count down — reusing the same number in two measures makes them the same music, so editing one edits both.",
	},
	{
		find: bySelector(".measureButtons"),
		title: "Adding and removing measures",
		body: "Append or drop a measure at the end of the song. Unlike upstream BeepBox, a new song is only as long as what you have actually written, instead of opening with a row of empty measures. The track scrolls sideways once it outgrows the window.",
	},
	{
		find: bySelector(".instrumentSlotBar"),
		title: "Instrument slots",
		body: "Add or remove channels. Each slot is its own row in the track with its own instrument, up to BeepBox's ceiling of ten pitch channels. Drum channels are still added from the Edit menu.",
	},
	{
		find: bySelector(".loopEditor"),
		title: "Loops and repeat sections",
		body: "The top bar is the playback loop, which repeats forever while you work. Beneath it are repeat sections: coloured bars that play a span a set number of times and then move on, the way written repeat signs do. Drag across empty measures to make one, drag its middle to move it or its ends to resize, click it to change how many times it repeats, and right-click to delete it. They can nest, and each nesting level gets its own row.",
	},
	{
		find: bySelector(".barScrollBar"),
		title: "Track scrollbar",
		body: "Slides the track sideways once the song is longer than the visible width, so the measure buttons at the end stay reachable.",
	},
	{
		find: bySelector(".instrument-settings-area"),
		title: "Instrument settings",
		body: "Everything about the sound of the selected channel. Start from a preset, then adjust the wave, fades, filters, effects and envelopes underneath. Any label in grey is clickable and explains that control in detail, and the ? beside the heading runs a second tour covering these settings one by one.",
	},
	{
		find: bySelector(".sheetMusicBar"),
		title: "Transpose and sheet music",
		body: "Opens the notation view. Choose an instrument for each part and it writes that part at the pitch the player actually reads, then draws it on a staff with the key, time signature and tempo. You can also apply those instruments back to the song.",
	},
	{
		find: bySelector(".tourButton"),
		title: "That's the tour",
		body: "This button is always here if you want to run through it again. If you are new to writing music, the fastest way to learn the editor is to place a few notes in the grid and press play.",
	},
];

export const INSTRUMENT_STEPS: TourStep[] = [
	{
		find: bySelector(".instrument-settings-area"),
		title: "Instrument settings",
		body: "Everything about the sound of the channel you have selected. What appears here changes with the instrument: press Customize to open the full set, and change Type to see the controls belonging to a different kind of synth. This tour skips anything that is not currently on screen, so run it again after switching type to hear about those controls.",
	},
	{
		find: (root) => rowByLabel(root, "Instrument"),
		title: "Instrument slots",
		body: "A channel can hold several instruments, and each pattern picks which one it uses. That is how one part switches between, say, a staccato and a sustained sound without needing its own channel.",
	},
	{
		find: (root) => rowByLabel(root, "Type"),
		title: "Type and presets",
		body: "Pick a ready-made preset, or one of the raw synth types at the top of the list. Presets are just a saved set of the controls below, so choosing one and then editing it is the normal way to work.",
	},
	{
		find: bySelector(".customize-instrument"),
		title: "Customize",
		body: "Opens the full set of controls for the current preset. Everything after this step is inside that panel, so if the rest of this tour looks short, press this first.",
	},
	{
		find: (root) => rowByLabel(root, "Volume"),
		title: "Instrument volume",
		body: "How loud this instrument is across the whole song. Use this to balance parts against each other; use the per-measure volume in Song Settings for a change in one place.",
	},
	{
		find: (root) => rowByLabel(root, "Panning"),
		title: "Panning",
		body: "Places the sound between the left and right speakers. Centre is the default; spreading parts apart makes a thick arrangement easier to hear into.",
	},
	{
		find: (root) => rowByLabel(root, "Reverb"),
		title: "Reverb",
		body: "The sense of a room around the sound. A little puts the instrument in a space rather than flat against your ear; a lot puts it in a hall and pushes it into the distance.",
	},
	{
		find: (root) => rowByLabel(root, "Wave"),
		title: "Wave",
		body: "The raw shape the oscillator repeats, and the single biggest influence on the character of a chip sound. A square is hollow and clarinet-like, a sawtooth is bright and brassy, a triangle is soft and flute-like.",
	},
	{
		find: (root) => rowByLabel(root, "Noise"),
		title: "Noise",
		body: "The kind of noise a drum or percussion channel is built from. Unlike a wave it has no pitch of its own, so what you choose here decides whether it reads as a snare, a cymbal or a hit.",
	},
	{
		find: (root) => rowByLabel(root, "Fade In/Out"),
		title: "Fade in and out",
		body: "How quickly a note reaches full volume and how long it takes to die away after it ends. A slow fade in gives a bowed or breathy attack; a long fade out lets notes ring into each other.",
	},
	{
		find: (root) => rowByLabel(root, "EQ Filter"),
		title: "EQ filter",
		body: "Shapes the tone of the instrument as a whole. Drag points on the graph to cut or boost a frequency range - rolling off the top makes a sound darker and more distant, cutting the bottom thins it out.",
	},
	{
		find: (root) => rowByLabel(root, "Unison"),
		title: "Unison",
		body: "Plays a second copy of the wave slightly apart from the first. A small detune gives a thick, chorused sound; larger settings give deliberate intervals like octaves or fifths.",
	},
	{
		find: (root) => rowByLabel(root, "Algorithm"),
		title: "FM algorithm",
		body: "How the FM operators feed into one another. An operator used as a carrier is heard directly; one used as a modulator instead bends the pitch of whatever it feeds, which is what produces FM's metallic and bell-like tones.",
	},
	{
		find: (root) => rowByLabel(root, "Feedback"),
		title: "Feedback",
		body: "Routes an operator back into itself or into another. Small amounts add bite and edge; large amounts break the tone up into noise.",
	},
	{
		find: (root) => rowByLabel(root, "Fdback Vol"),
		title: "Feedback volume",
		body: "How much of that feedback is applied. This is usually the fastest way to move an FM sound between mellow and harsh.",
	},
	{
		find: (root) => rowByLabel(root, "Spectrum"),
		title: "Spectrum",
		body: "Draw the strength of each frequency band directly. This is how BeepBox's drums are built - the shape you draw is the sound, rather than a wave being filtered into one.",
	},
	{
		find: (root) => rowByLabel(root, "Harmonics"),
		title: "Harmonics",
		body: "Draw the strength of each harmonic above the fundamental. Emphasising the odd ones gives a hollow, clarinet-like tone; a smooth run of them gives a full, string-like one.",
	},
	{
		find: (root) => rowByLabel(root, "Pulse Width"),
		title: "Pulse width",
		body: "How lopsided a square wave is. Exactly half is the hollow classic square; pushing it narrow thins the tone out and makes it more nasal.",
	},
	{
		find: (root) => rowByLabel(root, "Dynamism"),
		title: "Supersaw dynamism",
		body: "How much the stacked sawtooth voices drift against each other. More dynamism is a wider, more restless pad; less is tighter and more focused.",
	},
	{
		find: (root) => rowByLabel(root, "Spread"),
		title: "Supersaw spread",
		body: "How far apart in pitch those stacked voices sit. This is the control that takes a supersaw from a single hard lead to a huge wall of sound.",
	},
	{
		find: (root) => rowByLabel(root, "Saw↔Pulse"),
		title: "Saw to pulse",
		body: "Slides the stacked voices between sawtooth and pulse shapes, trading brightness for that hollow square character.",
	},
	{
		find: (root) => rowByLabel(root, "Sustain"),
		title: "String sustain",
		body: "How long a plucked string keeps ringing. Short is a damped, staccato pluck; long lets the note decay naturally like an undamped guitar.",
	},
	{
		find: bySelector(".effects-menu"),
		title: "Effects",
		body: "This menu switches effects on and off, and each one you enable adds its own controls to the list below. An effect that is off costs nothing and takes up no room, which is why this panel looks different from one instrument to the next.",
	},
	{
		find: (root) => rowByLabel(root, "Transition"),
		title: "Transition",
		body: "What happens where one note runs into the next: whether each is struck separately, or they slide and carry over into each other. This is the difference between a tongued and a slurred line.",
	},
	{
		find: (root) => rowByLabel(root, "Chords"),
		title: "Chords",
		body: "What to do when several notes sound at once - play them together, or arpeggiate them one after another. Older chip hardware could not play chords at all, which is why the arpeggio setting sounds so characteristic.",
	},
	{
		find: (root) => rowByLabel(root, "Pitch Shift"),
		title: "Pitch shift",
		body: "Moves this instrument up or down by whole steps without touching the notes you wrote. Handy for doubling a part an octave away.",
	},
	{
		find: (root) => rowByLabel(root, "Detune"),
		title: "Detune",
		body: "Nudges the tuning by a fraction of a step. A little against another instrument thickens both; a lot sounds deliberately out of tune.",
	},
	{
		find: (root) => rowByLabel(root, "Vibrato"),
		title: "Vibrato",
		body: "A regular wobble in pitch while a note is held, the way a singer or string player sustains one. The settings differ in how fast and how deep the wobble is, and how long it waits before starting.",
	},
	{
		find: (root) => rowByLabel(root, "Note Filter"),
		title: "Note filter",
		body: "Like the EQ filter, but applied to each note separately, which means an envelope can sweep it as the note plays. That sweep is what produces the classic filter 'wow' on a synth lead.",
	},
	{
		find: (root) => rowByLabel(root, "Distortion"),
		title: "Distortion",
		body: "Overdrives the sound, adding grit and harmonics. A little adds edge and helps a part cut through; a lot is the sound of a fuzzed guitar.",
	},
	{
		find: (root) => rowByLabel(root, "Bit Crush"),
		title: "Bit crush",
		body: "Throws away resolution, coarsening the sound into something rougher and more digital - the sound of cheap old hardware, on purpose.",
	},
	{
		find: (root) => rowByLabel(root, "Freq Crush"),
		title: "Frequency crush",
		body: "Lowers the sample rate rather than the resolution, which adds a harsh metallic ring on top. Paired with bit crush it is the core of a lo-fi sound.",
	},
	{
		find: (root) => rowByLabel(root, "Chorus"),
		title: "Chorus",
		body: "Layers slightly delayed and detuned copies of the sound, so one instrument sounds like several playing together. It widens a part without making it louder.",
	},
	{
		find: (root) => rowByLabel(root, "Echo"),
		title: "Echo",
		body: "Repeats the sound after a delay, each repeat quieter than the last. This control sets how much of each repeat feeds back, so how long the echoes take to die away.",
	},
	{
		find: (root) => rowByLabel(root, "Echo Delay"),
		title: "Echo delay",
		body: "How long the gap between repeats is. Matching it to the tempo makes the echoes fall on the beat instead of blurring across it.",
	},
	{
		find: bySelector(".envelopeEditor"),
		title: "Envelopes",
		body: "An envelope makes a control move on its own over the life of a note instead of staying put. Point one at a filter and it sweeps; at volume and the note swells or plucks. This is what separates a sound that is alive from one that just sits there.",
	},
	{
		find: bySelector(".instrumentTourButton"),
		title: "That's the instrument tour",
		body: "Anything skipped was not on screen for this instrument. Switch Type, press Customize, or turn on an effect, then run this again to hear about those controls.",
	},
];

export class Tour {
	private readonly _root: HTMLElement;
	private readonly _steps: TourStep[];
	private _index: number = 0;
	private _overlay: HTMLDivElement | null = null;
	private _resolvedSteps: {step: TourStep, target: HTMLElement}[] = [];

	// The spotlight is four panels around the target rather than one box with a
	// hole, so the page underneath stays visible and nothing needs an SVG mask.
	private readonly _panelTop: HTMLDivElement = div({class: "tourShade"});
	private readonly _panelBottom: HTMLDivElement = div({class: "tourShade"});
	private readonly _panelLeft: HTMLDivElement = div({class: "tourShade"});
	private readonly _panelRight: HTMLDivElement = div({class: "tourShade"});
	private readonly _ring: HTMLDivElement = div({class: "tourRing"});
	private readonly _title: HTMLElement = h2();
	private readonly _body: HTMLElement = p();
	private readonly _progress: HTMLElement = span({class: "tourProgress"});
	private readonly _backButton: HTMLButtonElement = button({type: "button"}, "Back");
	private readonly _nextButton: HTMLButtonElement = button({type: "button", class: "tourPrimary"}, "Next");
	private readonly _skipButton: HTMLButtonElement = button({type: "button"}, "Skip");
	private readonly _card: HTMLDivElement = div({class: "tourCard"},
		this._title,
		this._body,
		div({class: "tourControls"},
			this._progress,
			this._backButton,
			this._nextButton,
			this._skipButton,
		),
	);

	constructor(root: HTMLElement, steps: TourStep[]) {
		this._root = root;
		this._steps = steps;
		this._backButton.addEventListener("click", () => this._go(this._index - 1));
		this._nextButton.addEventListener("click", () => this._go(this._index + 1));
		this._skipButton.addEventListener("click", () => this.stop());
	}

	public start(): void {
		if (this._overlay != null) return;
		Tour._ensureStyle();

		// Steps whose target is missing or collapsed are dropped up front, so the
		// "step 4 of 20" count matches what the user will actually be shown.
		this._resolvedSteps = [];
		for (const step of this._steps) {
			const target: HTMLElement | null = step.find(this._root);
			if (target == null) continue;
			if (target.offsetWidth == 0 && target.offsetHeight == 0) continue;
			this._resolvedSteps.push({step, target: target});
		}
		if (this._resolvedSteps.length == 0) return;

		this._overlay = div({class: "tourOverlay"},
			this._panelTop, this._panelBottom, this._panelLeft, this._panelRight,
			this._ring, this._card,
		);
		document.body.appendChild(this._overlay);
		window.addEventListener("keydown", this._onKeyDown, true);
		window.addEventListener("resize", this._reposition);
		window.addEventListener("scroll", this._reposition, true);
		this._index = 0;
		this._render();
	}

	public stop(): void {
		if (this._overlay == null) return;
		window.removeEventListener("keydown", this._onKeyDown, true);
		window.removeEventListener("resize", this._reposition);
		window.removeEventListener("scroll", this._reposition, true);
		if (this._overlay.parentNode != null) this._overlay.parentNode.removeChild(this._overlay);
		this._overlay = null;
	}

	private _go(index: number): void {
		if (index < 0) return;
		if (index >= this._resolvedSteps.length) { this.stop(); return; }
		this._index = index;
		this._render();
	}

	private _onKeyDown = (event: KeyboardEvent): void => {
		if (this._overlay == null) return;
		if (event.key == "Escape") { this.stop(); }
		else if (event.key == "ArrowRight" || event.key == "Enter") { this._go(this._index + 1); }
		else if (event.key == "ArrowLeft") { this._go(this._index - 1); }
		else { return; }
		// The editor itself binds most keys, so stop them reaching it while the
		// tour is up - otherwise arrow keys would also move the selection.
		event.preventDefault();
		event.stopPropagation();
	}

	private _render(): void {
		const entry = this._resolvedSteps[this._index];
		this._title.textContent = entry.step.title;
		this._body.textContent = entry.step.body;
		this._progress.textContent = (this._index + 1) + " of " + this._resolvedSteps.length;
		this._backButton.style.visibility = this._index == 0 ? "hidden" : "";
		this._nextButton.textContent = this._index == this._resolvedSteps.length - 1 ? "Done" : "Next";
		this._skipButton.style.visibility = this._index == this._resolvedSteps.length - 1 ? "hidden" : "";

		entry.target.scrollIntoView({block: "center", inline: "center", behavior: "smooth"});
		// Let the smooth scroll settle before measuring, or the hole lands where
		// the target used to be.
		requestAnimationFrame(() => requestAnimationFrame(this._reposition));
	}

	private _reposition = (): void => {
		if (this._overlay == null) return;
		const entry = this._resolvedSteps[this._index];
		const rect: DOMRect = entry.target.getBoundingClientRect();
		const pad: number = 4;
		const top: number = Math.max(0, rect.top - pad);
		const left: number = Math.max(0, rect.left - pad);
		const right: number = Math.min(window.innerWidth, rect.right + pad);
		const bottom: number = Math.min(window.innerHeight, rect.bottom + pad);

		this._panelTop.style.cssText = `left:0;top:0;width:100%;height:${top}px;`;
		this._panelBottom.style.cssText = `left:0;top:${bottom}px;width:100%;height:${Math.max(0, window.innerHeight - bottom)}px;`;
		this._panelLeft.style.cssText = `left:0;top:${top}px;width:${left}px;height:${Math.max(0, bottom - top)}px;`;
		this._panelRight.style.cssText = `left:${right}px;top:${top}px;width:${Math.max(0, window.innerWidth - right)}px;height:${Math.max(0, bottom - top)}px;`;
		this._ring.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(0, right - left)}px;height:${Math.max(0, bottom - top)}px;`;

		// Prefer putting the card below the target, then above, then centred if the
		// target is tall enough to leave no room either way.
		const cardWidth: number = Math.min(340, window.innerWidth - 20);
		this._card.style.width = cardWidth + "px";
		const cardHeight: number = this._card.offsetHeight || 180;
		let cardTop: number = bottom + 12;
		if (cardTop + cardHeight > window.innerHeight - 8) {
			cardTop = top - cardHeight - 12;
		}
		if (cardTop < 8) {
			cardTop = Math.max(8, Math.min(window.innerHeight - cardHeight - 8, (window.innerHeight - cardHeight) / 2));
		}
		let cardLeft: number = rect.left + rect.width / 2 - cardWidth / 2;
		cardLeft = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, cardLeft));
		this._card.style.left = cardLeft + "px";
		this._card.style.top = cardTop + "px";
	}

	private static _styleAdded: boolean = false;
	private static _ensureStyle(): void {
		if (Tour._styleAdded) return;
		Tour._styleAdded = true;
		const style: HTMLStyleElement = document.createElement("style");
		style.appendChild(document.createTextNode(`
			.tourOverlay { position: fixed; inset: 0; z-index: 10001; }
			.tourShade { position: fixed; background: rgba(0, 0, 0, 0.72); }
			.tourRing {
				position: fixed; pointer-events: none; border-radius: 4px;
				box-shadow: 0 0 0 2px ${ColorConfig.linkAccent}, 0 0 14px 2px ${ColorConfig.linkAccent};
			}
			.tourCard {
				position: fixed; box-sizing: border-box;
				background: ${ColorConfig.editorBackground};
				border: 2px solid ${ColorConfig.linkAccent};
				border-radius: 6px; padding: 12px 14px;
				color: ${ColorConfig.primaryText};
				font-size: 13px; line-height: 1.45; text-align: left;
				box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
			}
			.tourCard h2 { margin: 0 0 6px 0; font-size: 15px; color: ${ColorConfig.linkAccent}; }
			.tourCard p { margin: 0 0 10px 0; }
			.tourControls { display: flex; align-items: center; gap: 6px; }
			.tourProgress { flex: 1; color: ${ColorConfig.secondaryText}; font-size: 12px; }
			.tourCard button {
				background: ${ColorConfig.uiWidgetBackground}; color: ${ColorConfig.primaryText};
				border: none; border-radius: 4px; height: 26px; padding: 0 12px;
				font-family: inherit; font-size: 12px; cursor: pointer;
			}
			.tourCard button:hover { background: ${ColorConfig.uiWidgetFocus}; }
			.tourCard button.tourPrimary { background: ${ColorConfig.linkAccent}; color: ${ColorConfig.editorBackground}; font-weight: bold; }
		`));
		document.head.appendChild(style);
	}
}
