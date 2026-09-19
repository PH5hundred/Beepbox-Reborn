// Sheet music rendering for BeepBox: Reborn.
//
// Takes the notes a user entered and draws them as notation, optionally
// transposed for a transposing instrument. BeepBox songs are in concert pitch,
// so "written pitch = sounding pitch + the part's interval".
var SheetMusic = (function () {
	"use strict";

	var SVGNS = "http://www.w3.org/2000/svg";

	// How far above concert pitch each instrument reads.
	var parts = [
		{name: "Concert pitch (no change)",   semitones: 0},
		{name: "B♭  trumpet, clarinet",  semitones: 2},
		{name: "E♭  alto sax, bari sax", semitones: 9},
		{name: "F  horn",                     semitones: 7},
		{name: "B♭ bass  tenor sax",     semitones: 14},
	];

	var COLORS = ["#25F3FF", "#FFFF25", "#FF9752", "#86FF25", "#FF90FF", "#9F31FF",
	              "#25C2FF", "#DFFF25", "#FF6A25", "#25FFC9"];
	function channelColor(i) { return COLORS[i % COLORS.length]; }

	// letter index (C=0..B=6) and accidental (-1 flat, 0 natural, 1 sharp)
	var SHARP_SPELL = [[0,0],[0,1],[1,0],[1,1],[2,0],[3,0],[3,1],[4,0],[4,1],[5,0],[5,1],[6,0]];
	var FLAT_SPELL  = [[0,0],[1,-1],[1,0],[2,-1],[2,0],[3,0],[4,-1],[4,0],[5,-1],[5,0],[6,-1],[6,0]];
	var LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11];

	// written key pitch class -> key signature
	var KEY_SIG = {
		0:  {type: 0, count: 0}, 7:  {type: 1, count: 1}, 2:  {type: 1, count: 2},
		9:  {type: 1, count: 3}, 4:  {type: 1, count: 4}, 11: {type: 1, count: 5},
		6:  {type: 1, count: 6}, 5:  {type: -1, count: 1}, 10: {type: -1, count: 2},
		3:  {type: -1, count: 3}, 8:  {type: -1, count: 4}, 1:  {type: -1, count: 5},
	};
	var SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];   // F C G D A E B
	var FLAT_ORDER  = [6, 2, 5, 1, 4, 0, 3];   // B E A D G C F

	function spell(midi, useSharps) {
		var pc = ((midi % 12) + 12) % 12;
		var entry = (useSharps ? SHARP_SPELL : FLAT_SPELL)[pc];
		var letter = entry[0], accidental = entry[1];
		// octave of the *letter*, so Cb/B# land on the right line
		var octave = Math.floor((midi - accidental) / 12) - 1;
		return {letter: letter, accidental: accidental, octave: octave,
		        diatonic: octave * 7 + letter};
	}

	function el(name, attrs, parent) {
		var e = document.createElementNS(SVGNS, name);
		for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, String(attrs[k]));
		if (parent) parent.appendChild(e);
		return e;
	}

	function glyph(parent, x, y, text, size, color) {
		var t = el("text", {x: x, y: y, "font-size": size || 16,
			"font-family": "Georgia, 'Times New Roman', serif", fill: color || "#000"}, parent);
		t.textContent = text;
		return t;
	}

	// ---- collecting the notes the user actually entered ---------------------
	function collectNotes(song, channelIndex) {
		var channel = song.channels[channelIndex];
		var partsPerBar = song.beatsPerBar * beepbox.Config.partsPerBeat;
		var out = [];
		for (var bar = 0; bar < song.barCount; bar++) {
			var patternIndex = channel.bars[bar];
			if (!patternIndex) continue;
			var pattern = channel.patterns[patternIndex - 1];
			if (!pattern) continue;
			for (var n = 0; n < pattern.notes.length; n++) {
				var note = pattern.notes[n];
				for (var p = 0; p < note.pitches.length; p++) {
					out.push({
						bar: bar,
						start: bar * partsPerBar + note.start,
						duration: note.end - note.start,
						pitch: note.pitches[p],
					});
				}
			}
		}
		out.sort(function (a, b) { return a.start - b.start || a.pitch - b.pitch; });
		return out;
	}

	function durationGlyph(parts_, partsPerBeat) {
		var beats = parts_ / partsPerBeat;
		if (beats >= 4)   return {filled: false, stem: false, flags: 0, dotted: false};
		if (beats >= 3)   return {filled: false, stem: true,  flags: 0, dotted: true};
		if (beats >= 2)   return {filled: false, stem: true,  flags: 0, dotted: false};
		if (beats >= 1.5) return {filled: true,  stem: true,  flags: 0, dotted: true};
		if (beats >= 1)   return {filled: true,  stem: true,  flags: 0, dotted: false};
		if (beats >= 0.5) return {filled: true,  stem: true,  flags: 1, dotted: false};
		return {filled: true, stem: true, flags: 2, dotted: false};
	}

	// ---- the renderer --------------------------------------------------------
	function renderChannel(song, channelIndex, partIndex) {
		var notes = collectNotes(song, channelIndex);
		var part = parts[partIndex] || parts[0];
		var basePitch = beepbox.Config.keys[song.key].basePitch;
		var partsPerBeat = beepbox.Config.partsPerBeat;
		var partsPerBar = song.beatsPerBar * partsPerBeat;

		var container = document.createElement("div");
		var title = document.createElement("div");
		title.className = "part-title";
		title.innerHTML = "Channel " + (channelIndex + 1) +
			' <span>&mdash; ' + part.name + "</span>";
		container.appendChild(title);

		if (notes.length === 0) {
			var empty = document.createElement("div");
			empty.className = "empty";
			empty.textContent = "No notes in this channel.";
			container.appendChild(empty);
			return container;
		}

		// written pitch = sounding + the part's interval
		for (var i = 0; i < notes.length; i++) {
			notes[i].midi = basePitch + notes[i].pitch + part.semitones;
		}

		var writtenKey = ((song.key + part.semitones) % 12 + 12) % 12;
		var sig = KEY_SIG[writtenKey] || {type: 0, count: 0};
		var useSharps = sig.type >= 0;

		// clef from the middle of the range
		var sorted = notes.map(function (n) { return n.midi; }).sort(function (a, b) { return a - b; });
		var median = sorted[Math.floor(sorted.length / 2)];
		var treble = median >= 57;
		// diatonic index of the bottom staff line: E4 for treble, G2 for bass
		var bottomDiatonic = treble ? spell(64, useSharps).diatonic : spell(43, useSharps).diatonic;

		// geometry
		var GAP = 7;                          // half a staff space
		var STAFF = GAP * 8;                  // four spaces
		var LEFT = 56;                        // clef + key signature
		var BAR_W = Math.max(90, 34 * song.beatsPerBar);
		var PER_LINE = Math.max(1, Math.min(4, Math.floor(760 / BAR_W)));
		var lines = Math.ceil(song.barCount / PER_LINE);
		var LINE_H = STAFF + 58;
		var width = LEFT + PER_LINE * BAR_W + 16;
		var height = lines * LINE_H + 16;

		var svg = el("svg", {width: width, height: height,
			viewBox: "0 0 " + width + " " + height, xmlns: SVGNS});

		for (var line = 0; line < lines; line++) {
			var top = 30 + line * LINE_H;
			var x0 = LEFT;
			var barsHere = Math.min(PER_LINE, song.barCount - line * PER_LINE);
			var lineW = barsHere * BAR_W;

			for (var s = 0; s < 5; s++) {
				el("line", {x1: 8, y1: top + s * GAP * 2, x2: x0 + lineW, y2: top + s * GAP * 2,
					stroke: "#000", "stroke-width": 1}, svg);
			}
			// clef
			glyph(svg, 12, treble ? top + GAP * 6.2 : top + GAP * 3.4,
				treble ? "\u{1D11E}" : "\u{1D122}", treble ? 46 : 38);

			// key signature
			var order = sig.type >= 0 ? SHARP_ORDER : FLAT_ORDER;
			for (var k = 0; k < sig.count; k++) {
				var letter = order[k];
				// place it in the octave that sits on the staff
				var d = bottomDiatonic + 2;
				while ((d % 7) !== letter) d++;
				if (d - bottomDiatonic > 8) d -= 7;
				var ky = top + STAFF - (d - bottomDiatonic) * GAP;
				glyph(svg, 34 + k * 7, ky + 5, sig.type >= 0 ? "♯" : "♭", 15);
			}

			// barlines
			for (var b = 0; b <= barsHere; b++) {
				el("line", {x1: x0 + b * BAR_W, y1: top, x2: x0 + b * BAR_W, y2: top + STAFF,
					stroke: "#000", "stroke-width": b === barsHere ? 2 : 1}, svg);
			}

			// notes on this line
			for (var ni = 0; ni < notes.length; ni++) {
				var note = notes[ni];
				var barOnLine = note.bar - line * PER_LINE;
				if (barOnLine < 0 || barOnLine >= barsHere) continue;

				var within = (note.start % partsPerBar) / partsPerBar;
				var cx = x0 + barOnLine * BAR_W + 14 + within * (BAR_W - 22);
				var sp = spell(note.midi, useSharps);
				var steps = sp.diatonic - bottomDiatonic;
				var cy = top + STAFF - steps * GAP;
				var shape = durationGlyph(note.duration, partsPerBeat);

				// ledger lines
				var L;
				for (L = -2; steps <= L; L -= 2) {
					el("line", {x1: cx - 9, y1: top + STAFF - L * GAP, x2: cx + 9,
						y2: top + STAFF - L * GAP, stroke: "#000", "stroke-width": 1}, svg);
				}
				for (L = 10; steps >= L; L += 2) {
					el("line", {x1: cx - 9, y1: top + STAFF - L * GAP, x2: cx + 9,
						y2: top + STAFF - L * GAP, stroke: "#000", "stroke-width": 1}, svg);
				}

				el("ellipse", {cx: cx, cy: cy, rx: 5.4, ry: 4,
					fill: shape.filled ? "#000" : "none",
					stroke: "#000", "stroke-width": shape.filled ? 0 : 1.4,
					transform: "rotate(-20 " + cx + " " + cy + ")"}, svg);

				if (shape.dotted) el("circle", {cx: cx + 10, cy: cy - 3, r: 1.5, fill: "#000"}, svg);

				if (shape.stem) {
					var up = steps < 4;
					var sx = cx + (up ? 5 : -5);
					var sy2 = cy + (up ? -26 : 26);
					el("line", {x1: sx, y1: cy, x2: sx, y2: sy2, stroke: "#000", "stroke-width": 1.3}, svg);
					for (var fl = 0; fl < shape.flags; fl++) {
						el("path", {d: "M " + sx + " " + (sy2 + fl * 6 * (up ? 1 : -1)) +
							" q 9 4 7 13", stroke: "#000", "stroke-width": 1.3, fill: "none"}, svg);
					}
				}

				// accidental when the note is not covered by the key signature
				var inKey = isInKeySignature(sp, sig);
				if (!inKey) {
					glyph(svg, cx - 17, cy + 5,
						sp.accidental === 1 ? "♯" : sp.accidental === -1 ? "♭" : "♮", 14);
				}
			}

			// measure numbers
			for (var m = 0; m < barsHere; m++) {
				glyph(svg, x0 + m * BAR_W + 2, top - 6, String(line * PER_LINE + m + 1), 9, "#888");
			}
		}

		container.appendChild(svg);
		return container;
	}

	function isInKeySignature(sp, sig) {
		var order = sig.type >= 0 ? SHARP_ORDER : FLAT_ORDER;
		var affected = order.slice(0, sig.count);
		var isAffected = affected.indexOf(sp.letter) !== -1;
		if (isAffected) return sp.accidental === (sig.type >= 0 ? 1 : -1);
		return sp.accidental === 0;
	}

	return {
		parts: parts,
		channelColor: channelColor,
		renderChannel: renderChannel,
	};
}());
