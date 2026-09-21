/* The transpose + sheet music interface, in one place so it can run either as
   its own page (transpose.html, when the site is served) or as an overlay
   inside the editor itself (beepbox_offline.html, which is a single file and
   has no transpose.html next to it to navigate to).

   Needs beepbox (Song/Config), INSTRUMENTS and SheetMusic to already be loaded. */
var TransposeUI = (function () {
	"use strict";

	// Every selector is scoped under .tui. The overlay drops this markup into the
	// editor page, which has button/select rules of its own that would otherwise
	// fight with these.
	var CSS = [
		".tui { font-family: 'Roboto', sans-serif; font-size: 13px; line-height: 1.4; color: #fff; text-align: left; }",
		".tui h1 { font-size: 20px; margin: 0 0 2px 0; }",
		".tui .sub { color: #999; margin-bottom: 18px; }",
		".tui a { color: #ff4452; }",
		".tui .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin-bottom: 6px; background: #1c1c1c; border-radius: 5px; }",
		".tui .swatch { width: 10px; height: 22px; border-radius: 3px; flex-shrink: 0; }",
		".tui .name { flex: 1; min-width: 0; }",
		".tui .name b { display: block; }",
		".tui .name span { color: #999; font-size: 12px; }",
		".tui select { background: #444; color: #fff; border: none; border-radius: 4px; height: 26px; font-family: inherit; font-size: 12px; padding: 0 6px; max-width: 230px; }",
		".tui button { background: #444; color: #fff; border: none; border-radius: 5px; height: 30px; padding: 0 14px; font-family: inherit; font-size: 13px; cursor: pointer; }",
		".tui button:hover { background: #555; }",
		".tui button.primary { background: #ff4452; color: #fff; font-weight: bold; }",
		".tui button.primary:hover { filter: brightness(1.1); }",
		".tui .bar { display: flex; gap: 8px; align-items: center; margin: 16px 0; flex-wrap: wrap; }",
		".tui .note { color: #999; font-size: 12px; }",
		".tui .sheet { margin-top: 20px; }",
		".tui .sheet svg { background: #fff; border-radius: 4px; margin-bottom: 10px; display: block; max-width: 100%; height: auto; }",
		".tui .empty { color: #999; font-style: italic; }",
		/* overlay only */
		".tui-overlay { position: fixed; inset: 0; z-index: 10000; background: #000; overflow-y: auto; -webkit-overflow-scrolling: touch; }",
		".tui-overlay .tui { max-width: 900px; margin: 0 auto; padding: 16px 16px 60px 16px; }"
	].join("\n");

	function ensureStyle() {
		if (document.getElementById("transposeui-style")) return;
		var style = document.createElement("style");
		style.id = "transposeui-style";
		style.appendChild(document.createTextNode(CSS));
		document.head.appendChild(style);
	}

	function el(tag, className, html) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (html != null) node.innerHTML = html;
		return node;
	}

	/* Builds the interface into `root` for `song`.
	   opts.onApply(songString) is called when the user applies instrument choices;
	   opts.onClose, when given, adds a button that calls it. */
	function mount(root, song, opts) {
		opts = opts || {};
		ensureStyle();
		root.classList.add("tui");
		root.innerHTML = "";

		root.appendChild(el("h1", null, "Transpose &amp; Sheet Music"));

		var info = el("div", "sub");
		var keyName = beepbox.Config.keys[song.key].name;
		info.innerHTML = "Concert <b>" + keyName + "</b> &middot; " + song.barCount +
			" measure" + (song.barCount === 1 ? "" : "s") + " &middot; " +
			song.beatsPerBar + " beats per measure &middot; " + song.tempo + " BPM";
		root.appendChild(info);

		root.appendChild(el("div", "sub", "Pick an instrument for each part. That swaps the sound <em>and</em> " +
			"writes the part at the pitch that player reads &mdash; concert B&#9837; shows as G for an alto sax."));

		var partsEl = el("div");
		root.appendChild(partsEl);

		// Each row picks what the part should be WRITTEN for. BeepBox songs are in
		// concert pitch, so "Keep current instrument" means leave it alone.
		var selects = [];
		for (var i = 0; i < song.getChannelCount(); i++) {
			if (song.getChannelIsNoise(i)) continue;
			var channel = song.channels[i];
			var noteCount = 0;
			for (var p = 0; p < channel.patterns.length; p++) noteCount += channel.patterns[p].notes.length;

			var row = el("div", "row");

			var sw = el("div", "swatch");
			sw.style.background = SheetMusic.channelColor(i);
			row.appendChild(sw);

			row.appendChild(el("div", "name", "<b>Channel " + (i + 1) + "</b><span>" + noteCount +
				" note" + (noteCount === 1 ? "" : "s") + "</span>"));

			var sel = document.createElement("select");
			var keep = document.createElement("option");
			keep.value = "-1";
			keep.textContent = "Keep current instrument";
			sel.appendChild(keep);
			for (var t = 0; t < INSTRUMENTS.length; t++) {
				var opt = document.createElement("option");
				opt.value = String(t);
				opt.textContent = INSTRUMENTS[t].name + (INSTRUMENTS[t].semitones ? "" : "  · concert");
				sel.appendChild(opt);
			}
			sel.value = "-1";
			row.appendChild(sel);
			selects.push({channelIndex: i, select: sel});

			partsEl.appendChild(row);
		}

		if (selects.length === 0) {
			partsEl.appendChild(el("div", "empty", "This song has no pitched channels to transpose."));
		}

		var bar = el("div", "bar");
		var generateButton = el("button", "primary");
		generateButton.type = "button";
		generateButton.textContent = "Generate Sheet Music";
		var applyButton = el("button");
		applyButton.type = "button";
		applyButton.textContent = "Apply instruments & open in editor";
		bar.appendChild(generateButton);
		bar.appendChild(applyButton);
		if (opts.onClose) {
			var closeButton = el("button");
			closeButton.type = "button";
			closeButton.textContent = "Back to editor";
			closeButton.addEventListener("click", opts.onClose);
			bar.appendChild(closeButton);
		}
		var status = el("span", "note");
		bar.appendChild(status);
		root.appendChild(bar);

		var sheet = el("div", "sheet");
		root.appendChild(sheet);

		function chosen(entry) {
			var idx = parseInt(entry.select.value, 10);
			return idx >= 0 ? INSTRUMENTS[idx] : null;
		}

		function regenerate() {
			sheet.innerHTML = "";
			var wrote = 0;
			for (var s = 0; s < selects.length; s++) {
				var out = SheetMusic.renderChannel(song, selects[s].channelIndex, chosen(selects[s]));
				if (out) { sheet.appendChild(out); wrote++; }
			}
			status.textContent = wrote === 0
				? "Nothing to write - no notes in this song yet."
				: "Wrote " + wrote + " part" + (wrote === 1 ? "" : "s") + ".";
		}

		generateButton.addEventListener("click", regenerate);

		// Redraw as soon as an instrument changes, so what is on screen always
		// matches the dropdowns rather than the last time Generate was pressed.
		for (var q = 0; q < selects.length; q++) {
			selects[q].select.addEventListener("change", function () {
				if (sheet.children.length) regenerate();
			});
		}

		// Swapping the instrument changes the song itself, so hand the edited song
		// back to the editor.
		applyButton.addEventListener("click", function () {
			var changed = 0;
			for (var s = 0; s < selects.length; s++) {
				var instrument = chosen(selects[s]);
				if (!instrument) continue;
				var channel = song.channels[selects[s].channelIndex];
				for (var k = 0; k < channel.instruments.length; k++) {
					channel.instruments[k].fromJsonObject(instrument.settings, false, 0);
					channel.instruments[k].preset = instrument.value;
				}
				changed++;
			}
			if (changed === 0) {
				status.textContent = "No instruments picked yet.";
				return;
			}
			if (opts.onApply) opts.onApply(song.toBase64String());
		});
	}

	/* Opens the interface on top of whatever page is already loaded. Used by the
	   offline single-file build, where there is no separate page to go to. */
	function openOverlay(song, opts) {
		opts = opts || {};
		ensureStyle();
		var overlay = el("div", "tui-overlay");
		var inner = el("div");
		overlay.appendChild(inner);

		function close() {
			if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
			document.removeEventListener("keydown", onKey);
		}
		function onKey(event) { if (event.keyCode === 27) close(); }
		document.addEventListener("keydown", onKey);

		mount(inner, song, {
			onClose: close,
			onApply: opts.onApply || function (songString) {
				// The editor reads its song out of the hash on load, so the simplest
				// way to hand the edited song back is to reload onto it.
				window.location.hash = songString;
				window.location.reload();
			}
		});

		document.body.appendChild(overlay);
		overlay.scrollTop = 0;
		return close;
	}

	return {mount: mount, openOverlay: openOverlay};
}());
