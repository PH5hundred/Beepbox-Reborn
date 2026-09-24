// Added in Beepbox Reborn: type to find an instrument instead of scrolling the
// preset menu, which holds a couple of hundred entries in about twenty groups.
// It never picks an instrument itself; it sets the real preset menu and lets
// that menu's own change handler do the work, so search and menu cannot disagree.

import {HTML} from "imperative-html/dist/esm/elements-strict.js";

interface Match {
	readonly option: HTMLOptionElement;
	readonly name: string;
	readonly group: string;
}

export class PresetSearch {
	private readonly _input: HTMLInputElement = HTML.input({type: "text", class: "presetSearchInput", placeholder: "Search instruments…", autocomplete: "off", spellcheck: false, title: "Type part of an instrument's name or its group, like \"sax\" or \"retro\""});
	private readonly _results: HTMLDivElement = HTML.div({class: "presetSearchResults", style: "display: none;"});
	public readonly container: HTMLDivElement = HTML.div({class: "presetSearch"}, this._input, this._results);
	
	private _matches: Match[] = [];
	private _highlighted: number = 0;
	
	// The pitched and drum menus are separate selects and only one applies to the
	// current channel, so ask for it each time rather than holding one.
	constructor(private readonly _getMenu: () => HTMLSelectElement) {
		this._input.addEventListener("input", this._onInput);
		this._input.addEventListener("keydown", this._onKeyDown);
		this._input.addEventListener("blur", this._close);
		// The editor turns letters into piano notes and R into "random preset", so
		// none of what is typed here may reach its shortcut handlers.
		for (const type of ["keydown", "keyup", "keypress"]) {
			this._input.addEventListener(type, event => event.stopPropagation());
		}
		// mousedown, not click: the input's blur would close the list before a click landed.
		this._results.addEventListener("mousedown", this._onResultPressed);
	}
	
	private _search(query: string): Match[] {
		const tokens: string[] = query.toLowerCase().split(/\s+/).filter(token => token != "");
		if (tokens.length == 0) return [];
		const found: {match: Match, rank: number}[] = [];
		for (const option of Array.from(this._getMenu().options)) {
			// The Edit group (copy, paste, random) has words for values, not presets.
			if (isNaN(Number(option.value))) continue;
			const group: string = (option.parentElement instanceof HTMLOptGroupElement) ? option.parentElement.label : "";
			const name: string = option.text.trim().toLowerCase();
			const haystack: string = name + " " + group.toLowerCase();
			if (!tokens.every(token => haystack.indexOf(token) != -1)) continue;
			// Names that start with what was typed come first, then names that
			// contain it, then matches that are only in the group's name.
			const rank: number = name.startsWith(tokens[0]) ? 0 : tokens.every(token => name.indexOf(token) != -1) ? 1 : 2;
			found.push({match: {option, name: option.text.trim(), group}, rank});
		}
		return found.map((entry, order) => ({entry, order}))
			.sort((a, b) => a.entry.rank - b.entry.rank || a.order - b.order)
			.map(item => item.entry.match);
	}
	
	private _render(): void {
		this._results.textContent = "";
		if (this._matches.length == 0) {
			if (this._input.value.trim() != "") {
				this._results.appendChild(HTML.div({class: "presetSearchNone"}, "No instrument matches"));
				this._results.style.display = "";
			} else {
				this._results.style.display = "none";
			}
			return;
		}
		this._matches.forEach((match: Match, index: number) => {
			const row: HTMLDivElement = HTML.div({class: "presetSearchResult" + (index == this._highlighted ? " highlighted" : ""), "data-index": String(index)},
				HTML.span({}, match.name),
				HTML.span({class: "presetSearchGroup"}, match.group),
			);
			this._results.appendChild(row);
		});
		this._results.style.display = "";
		const highlighted: Element | null = this._results.querySelector(".highlighted");
		if (highlighted != null) (<HTMLElement> highlighted).scrollIntoView({block: "nearest"});
	}
	
	private _onInput = (): void => {
		this._matches = this._search(this._input.value);
		this._highlighted = 0;
		this._render();
	}
	
	private _onKeyDown = (event: KeyboardEvent): void => {
		if (event.key == "ArrowDown" || event.key == "ArrowUp") {
			if (this._matches.length == 0) return;
			const step: number = event.key == "ArrowDown" ? 1 : -1;
			this._highlighted = (this._highlighted + step + this._matches.length) % this._matches.length;
			this._render();
			event.preventDefault();
		} else if (event.key == "Enter") {
			if (this._matches.length > 0) this._choose(this._matches[this._highlighted]);
			event.preventDefault();
		} else if (event.key == "Escape") {
			this._close();
			this._input.value = "";
			this._input.blur();
			event.preventDefault();
		}
	}
	
	private _onResultPressed = (event: MouseEvent): void => {
		const row: HTMLElement | null = (<HTMLElement> event.target).closest(".presetSearchResult");
		if (row == null) return;
		this._choose(this._matches[Number(row.getAttribute("data-index"))]);
		event.preventDefault();
	}
	
	private _choose(match: Match): void {
		const menu: HTMLSelectElement = this._getMenu();
		menu.value = match.option.value;
		menu.dispatchEvent(new Event("change", {bubbles: true}));
		this._close();
		this._input.value = "";
		this._input.blur();
	}
	
	private _close = (): void => {
		this._matches = [];
		this._results.style.display = "none";
		this._results.textContent = "";
	}
}
