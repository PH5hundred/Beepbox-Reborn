// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {HTML} from "imperative-html/dist/esm/elements-strict.js";
import {SongDocument} from "./SongDocument.js";
import {Prompt} from "./Prompt.js";
import {ColorConfig} from "./ColorConfig.js";

const {button, div, span, h2, input, br} = HTML;

export class SwingPrompt implements Prompt {
	private readonly _amountStepper: HTMLInputElement = input({style: "width: 3em; margin-left: 1em;", type: "number", min: "0", max: "100", step: "1", value: "60"});
	private readonly _cancelButton: HTMLButtonElement = button({class: "cancelButton"});
	private readonly _okayButton: HTMLButtonElement = button({class: "okayButton", style: "width:45%;"}, "Okay");

	public readonly container: HTMLDivElement = div({class: "prompt noSelection", style: "width: 250px;"},
		h2("Apply Swing To Selection"),
		div({style: "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;"},
			div({style: "text-align: right;"},
				"Swing amount:",
				br(),
				span({style: `font-size: smaller; color: ${ColorConfig.secondaryText};`}, "(0 = straight 8ths, 100 = triplet shuffle)"),
			),
			this._amountStepper,
			span({style: "margin-left: 0.3em;"}, "%"),
		),
		div({style: `display: flex; flex-direction: row; justify-content: center; font-size: smaller; color: ${ColorConfig.secondaryText}; margin-top: 0.5em;`},
			"Delays every off-beat 8th note in the selected measures. Notes not on that grid are left alone.",
		),
		div({style: "display: flex; flex-direction: row-reverse; justify-content: space-between; margin-top: 1em;"},
			this._okayButton,
		),
		this._cancelButton,
	);

	constructor(private _doc: SongDocument) {
		const lastAmount: string | null = window.localStorage.getItem("swingAmount");
		if (lastAmount != null) {
			this._amountStepper.value = lastAmount;
		}

		this._amountStepper.select();
		setTimeout(()=>this._amountStepper.focus());

		this._okayButton.addEventListener("click", this._saveChanges);
		this._cancelButton.addEventListener("click", this._close);
		this._amountStepper.addEventListener("blur", SwingPrompt._validateNumber);
		this.container.addEventListener("keydown", this._whenKeyPressed);
	}

	private _close = (): void => {
		this._doc.undo();
	}

	public cleanUp = (): void => {
		this._okayButton.removeEventListener("click", this._saveChanges);
		this._cancelButton.removeEventListener("click", this._close);
		this._amountStepper.removeEventListener("blur", SwingPrompt._validateNumber);
		this.container.removeEventListener("keydown", this._whenKeyPressed);
	}

	private _whenKeyPressed = (event: KeyboardEvent): void => {
		if ((<Element> event.target).tagName != "BUTTON" && event.keyCode == 13) { // Enter key
			this._saveChanges();
		}
	}

	private static _validateNumber(event: Event): void {
		const input: HTMLInputElement = <HTMLInputElement>event.target;
		let value: number = Math.round(+input.value);
		input.value = Math.max(+input.min, Math.min(+input.max, value)) + "";
	}

	private _saveChanges = (): void => {
		window.localStorage.setItem("swingAmount", this._amountStepper.value);
		this._doc.prompt = null;
		this._doc.selection.swing(+this._amountStepper.value / 100);
	}
}
