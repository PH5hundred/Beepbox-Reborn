// Added in Beepbox Reborn: the contents of the Mixer tab. Two views of the same
// per-measure volumes - faders for the instrument's overall level, and a grid for
// setting individual measures - with a switch between them.

import {SongDocument} from "./SongDocument.js";
import {MixerEditor} from "./MixerEditor.js";
import {MixerStrips} from "./MixerStrips.js";
import {HTML} from "imperative-html/dist/esm/elements-strict.js";

export class MixerPanel {
	private readonly _strips: MixerStrips;
	private readonly _grid: MixerEditor;
	private _view: "faders" | "measures" = "faders";
	
	private readonly _fadersButton: HTMLButtonElement = HTML.button({type: "button", class: "mixerView", title: "One fader per instrument for its overall level"}, "Faders");
	private readonly _measuresButton: HTMLButtonElement = HTML.button({type: "button", class: "mixerView", title: "Set the volume of each instrument in each measure"}, "Per measure");
	public readonly container: HTMLDivElement;
	
	constructor(private readonly _doc: SongDocument) {
		this._strips = new MixerStrips(_doc);
		this._grid = new MixerEditor(_doc);
		this._fadersButton.addEventListener("click", () => this._setView("faders"));
		this._measuresButton.addEventListener("click", () => this._setView("measures"));
		this.container = HTML.div({class: "mixerPanel"},
			HTML.div({class: "mixerViews"}, this._fadersButton, this._measuresButton),
			this._strips.container,
			this._grid.container,
		);
	}
	
	// For the guided tour, which needs a view on screen at once and has no use
	// for the notification (it renders straight afterwards).
	public get view(): "faders" | "measures" { return this._view; }
	public showView(view: "faders" | "measures"): void { this._view = view; }

	private _setView(view: "faders" | "measures"): void {
		if (this._view == view) return;
		this._view = view;
		this._doc.notifier.changed();
	}
	
	public render(): void {
		const faders: boolean = this._view == "faders";
		this._fadersButton.classList.toggle("selected", faders);
		this._measuresButton.classList.toggle("selected", !faders);
		this._strips.container.style.display = faders ? "" : "none";
		this._grid.container.style.display = faders ? "none" : "";
		if (faders) this._strips.render(); else this._grid.render();
	}
}
