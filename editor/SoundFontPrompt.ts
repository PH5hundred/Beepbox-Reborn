// Added in Beepbox Reborn: import and remove SoundFonts kept in this browser.

import {SongDocument} from "./SongDocument.js";
import {Prompt} from "./Prompt.js";
import {HTML} from "imperative-html/dist/esm/elements-strict.js";
import {SoundFontLibrary, InstalledSoundFont} from "./SoundFontLibrary.js";
import {SoundFontError} from "./SoundFont.js";

const {button, div, h2, input, p, span} = HTML;

function fileSize(byteLength: number): string {
	return (byteLength < 1024 * 1024) ? Math.max(1, Math.round(byteLength / 1024)) + " KB" : (byteLength / (1024 * 1024)).toFixed(1) + " MB";
}

export class SoundFontPrompt implements Prompt {
	private readonly _fileInput: HTMLInputElement = input({type: "file", accept: ".sf2"});
	private readonly _status: HTMLParagraphElement = p({style: "margin: 0.5em 0; display: none;"});
	private readonly _fontList: HTMLDivElement = div({style: "max-height: 200px; overflow-y: auto; text-align: left;"});
	private readonly _cancelButton: HTMLButtonElement = button({class: "cancelButton"});

	public readonly container: HTMLDivElement = div({class: "prompt noSelection", style: "width: 300px;"},
		h2("SoundFonts"),
		p({style: "text-align: left; margin: 0.5em 0;"},
			"Load a .sf2 SoundFont to play its instruments. Each one shows up in the instrument menu under \"Imported: \" and its name.",
		),
		p({style: "text-align: left; margin: 0.5em 0;"},
			"Imported SoundFonts are saved in this browser only. A song that uses one plays those instruments silently on any other computer, unless that computer imports the same file.",
		),
		this._fileInput,
		this._status,
		this._fontList,
		this._cancelButton,
	);

	constructor(private _doc: SongDocument) {
		this._fileInput.addEventListener("change", this._whenFileSelected);
		this._cancelButton.addEventListener("click", this._close);
		SoundFontLibrary.onChange(this._renderList);
		this._renderList();
	}

	private _close = (): void => {
		this._doc.undo();
	}

	public cleanUp = (): void => {
		SoundFontLibrary.offChange(this._renderList);
		this._fileInput.removeEventListener("change", this._whenFileSelected);
		this._cancelButton.removeEventListener("click", this._close);
	}

	private _showStatus(message: string): void {
		this._status.textContent = message;
		this._status.style.display = (message == "") ? "none" : "";
	}

	private _renderList = (): void => {
		const fonts: ReadonlyArray<InstalledSoundFont> = SoundFontLibrary.list();
		this._fontList.textContent = "";
		if (fonts.length == 0) {
			this._fontList.appendChild(p({style: "margin: 0;"}, "No SoundFonts imported yet."));
			return;
		}
		for (const font of fonts) {
			const removeButton: HTMLButtonElement = button({type: "button", style: "flex-shrink: 0; padding: 0 0.75em;"}, "Remove");
			removeButton.addEventListener("click", () => {
				removeButton.disabled = true;
				SoundFontLibrary.remove(font.name).then(() => this._showStatus("Removed \"" + font.name + "\"."));
			});
			this._fontList.appendChild(div({style: "display: flex; align-items: center; gap: 8px; margin: 4px 0;"},
				span({style: "flex-grow: 1; overflow: hidden; text-overflow: ellipsis;", title: font.name}, font.name + " (" + font.presetCount + " instruments, " + fileSize(font.byteLength) + ")"),
				removeButton,
			));
		}
	}

	private _whenFileSelected = (): void => {
		const file: File | undefined = this._fileInput.files?.[0];
		if (!file) return;
		this._showStatus("Loading \"" + file.name + "\"...");
		this._fileInput.disabled = true;
		file.arrayBuffer()
			.then(bytes => SoundFontLibrary.importFile(file.name, bytes))
			.then(({font, saved}) => {
				let message: string = "Imported " + font.presetCount + " instruments from \"" + font.name + "\".";
				if (!saved) message += " This browser couldn't save it, so it will be gone after you close the page.";
				this._showStatus(message);
			})
			.catch(error => {
				if (!(error instanceof SoundFontError)) console.error(error);
				this._showStatus((error instanceof Error) ? error.message : "That file couldn't be imported.");
			})
			.then(() => {
				this._fileInput.disabled = false;
				this._fileInput.value = "";
			});
	}
}
