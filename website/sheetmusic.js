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

	// Where each key-signature accidental sits, in half-steps above the bottom
	// staff line. Fixed by convention, not derived from the pitch.
	var SIG_POS = {
		treble: {sharp: [8, 5, 9, 6, 3, 7, 4], flat: [4, 7, 3, 6, 2, 5, 1]},
		bass:   {sharp: [6, 3, 7, 4, 1, 5, 2], flat: [2, 5, 1, 4, 0, 3, -1]},
	};

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

	// Pitches sounding at the same instant are one chord and share a stem. Drawn
	// separately they each grow their own stem through the others' noteheads,
	// which is most of what looks like overlap.
	function groupChords(notes) {
		var groups = [], current = null;
		for (var i = 0; i < notes.length; i++) {
			if (current !== null && notes[i].start === current[0].start &&
			    notes[i].bar === current[0].bar) {
				current.push(notes[i]);
			} else {
				current = [notes[i]];
				groups.push(current);
			}
		}
		return groups;
	}

	// The two dots of a repeat sign, in the second and fourth spaces.
	function repeatDots(svg, x, top, STAFF, GAP) {
		el("circle", {cx: x, cy: top + STAFF - 3 * GAP, r: 1.8, fill: "#000"}, svg);
		el("circle", {cx: x, cy: top + STAFF - 5 * GAP, r: 1.8, fill: "#000"}, svg);
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
	// instrument: {name, semitones} or null to leave the part at concert pitch.
	function renderChannel(song, channelIndex, instrument) {
		var notes = collectNotes(song, channelIndex);
		var part = instrument || {name: "Concert pitch", semitones: 0};
		var basePitch = beepbox.Config.keys[song.key].basePitch;
		var partsPerBeat = beepbox.Config.partsPerBeat;
		var partsPerBar = song.beatsPerBar * partsPerBeat;

		var container = document.createElement("div");
		var title = document.createElement("div");
		title.className = "part-title";
		var KEY_NAMES = ["C", "D\u266D", "D", "E\u266D", "E", "F",
		                 "G\u266D", "G", "A\u266D", "A", "B\u266D", "B"];
		var writtenKeyName = KEY_NAMES[((song.key + part.semitones) % 12 + 12) % 12];
		title.innerHTML = "Channel " + (channelIndex + 1) +
			' <span>&mdash; ' + part.name +
			(part.semitones ? " &middot; written in " + writtenKeyName +
				" (sounds " + KEY_NAMES[song.key] + ")" : " &middot; " + KEY_NAMES[song.key]) +
			"</span>";
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
		var LEFT = 34 + Math.max(1, sig.count) * 8 + 26;   // clef + key signature + time signature
		var BAR_W = Math.max(90, 34 * song.beatsPerBar);
		var PER_LINE = Math.max(1, Math.min(4, Math.floor(760 / BAR_W)));
		var lines = Math.ceil(song.barCount / PER_LINE);

		// How far the music actually reaches outside the staff. A fixed system
		// height is what made ledger-line notes collide with the system below, so
		// measure the range first and give every system room for the worst case.
		var lowSteps = Infinity, highSteps = -Infinity;
		for (i = 0; i < notes.length; i++) {
			var st = spell(notes[i].midi, useSharps).diatonic - bottomDiatonic;
			if (st < lowSteps) lowSteps = st;
			if (st > highSteps) highSteps = st;
		}
		var REACH = 34;                       // stem plus a flag or two
		var above = Math.max(16, (Math.max(0, highSteps - 8)) * GAP + REACH);
		var below = Math.max(12, (Math.max(0, -lowSteps)) * GAP + REACH);
		var SYSTEM_GAP = 16;
		var TOP_PAD = 26;                     // tempo mark and measure numbers
		var LINE_H = above + STAFF + below + SYSTEM_GAP;
		var width = LEFT + PER_LINE * BAR_W + 16;
		var height = TOP_PAD + lines * LINE_H + 8;

		var svg = el("svg", {width: width, height: height,
			viewBox: "0 0 " + width + " " + height, xmlns: SVGNS});

		// tempo mark, written above the first system
		glyph(svg, 8, 16, "\u2669 = " + song.tempo, 12);

		var clefs = [];
		var chords = groupChords(notes);

		// Where repeat signs go. A section's end is exclusive, so its closing sign
		// sits on the barline at song bar `start + length`. Nested sections can
		// open or close at the same barline; one sign there covers them.
		var repeatStartAt = {}, repeatEndAt = {};
		var sections = song.repeatSections || [];
		for (var r = 0; r < sections.length; r++) {
			var sec = sections[r];
			repeatStartAt[sec.start] = true;
			var endBar = sec.start + sec.length;
			repeatEndAt[endBar] = Math.max(repeatEndAt[endBar] || 0, sec.repeatCount);
		}

		for (var line = 0; line < lines; line++) {
			var top = TOP_PAD + above + line * LINE_H;
			var x0 = LEFT;
			var barsHere = Math.min(PER_LINE, song.barCount - line * PER_LINE);
			var lineW = barsHere * BAR_W;

			for (var s = 0; s < 5; s++) {
				el("line", {x1: 8, y1: top + s * GAP * 2, x2: x0 + lineW, y2: top + s * GAP * 2,
					stroke: "#000", "stroke-width": 1}, svg);
			}
			// Clef. A treble clef must curl around the G line (2nd from the
			// bottom) and a bass clef sit on the F line (2nd from the top) -
			// that is the reference a reader counts from, so a clef placed by
			// guesswork shifts every note. Font metrics for these glyphs vary,
			// so measure the drawn glyph and align its centre to that line
			// rather than trusting an offset.
			clefs.push({
				node: glyph(svg, 12, top + STAFF / 2, treble ? "\u{1D11E}" : "\u{1D122}",
					treble ? 46 : 38),
				lineY: top + STAFF - (treble ? 2 : 6) * GAP,
				// Where the reference point sits within the glyph: the treble
				// spiral is low in its box, the bass curl and dots are high.
				anchor: treble ? 0.72 : 0.26,
			});

			// key signature, at the conventional staff positions
			var posList = SIG_POS[treble ? "treble" : "bass"][sig.type >= 0 ? "sharp" : "flat"];
			for (var k = 0; k < sig.count; k++) {
				var ky = top + STAFF - posList[k] * GAP;
				glyph(svg, 30 + k * 8, ky + 5, sig.type >= 0 ? "♯" : "♭", 15);
			}

			// time signature, once, at the start
			if (line === 0) {
				var tsx = LEFT - 11;
				var unit = song.beatUnit || 4;
				glyph(svg, tsx, top + GAP * 3.6, String(song.beatsPerBar), 15);
				glyph(svg, tsx, top + STAFF - 1, String(unit), 15);
			}

			// barlines, with repeat signs wherever a repeat section opens or closes
			for (var b = 0; b <= barsHere; b++) {
				var bx = x0 + b * BAR_W;
				var absBar = line * PER_LINE + b;
				// A boundary at a line break belongs to both lines, so split it the
				// way notation does: the closing sign ends the earlier line and the
				// opening sign starts the later one, never both in both places.
				var opens = repeatStartAt.hasOwnProperty(absBar) && b !== barsHere;
				var closes = repeatEndAt.hasOwnProperty(absBar) && b !== 0;

				if (!opens && !closes) {
					el("line", {x1: bx, y1: top, x2: bx, y2: top + STAFF,
						stroke: "#000", "stroke-width": b === barsHere ? 2 : 1}, svg);
					continue;
				}

				el("line", {x1: bx, y1: top, x2: bx, y2: top + STAFF,
					stroke: "#000", "stroke-width": 4}, svg);
				if (closes) {
					el("line", {x1: bx - 5, y1: top, x2: bx - 5, y2: top + STAFF,
						stroke: "#000", "stroke-width": 1}, svg);
					repeatDots(svg, bx - 9, top, STAFF, GAP);
					// repeatCount is extra passes, so a count of 1 is the plain
					// "play it twice" that needs no number written over it.
					var times = repeatEndAt[absBar] + 1;
					if (times > 2) glyph(svg, bx - 18, top - 6, "×" + times, 10);
				}
				if (opens) {
					el("line", {x1: bx + 5, y1: top, x2: bx + 5, y2: top + STAFF,
						stroke: "#000", "stroke-width": 1}, svg);
					repeatDots(svg, bx + 8, top, STAFF, GAP);
				}
			}

			// notes on this line, one chord at a time. An accidental holds for the
			// rest of its measure, so remember what has already been marked and do
			// not print it again on every repeat of the same note.
			var accidentalBar = -1, accidentalsSoFar = {};

			for (var ci = 0; ci < chords.length; ci++) {
				var chord = chords[ci];
				var barOnLine = chord[0].bar - line * PER_LINE;
				if (barOnLine < 0 || barOnLine >= barsHere) continue;
				if (chord[0].bar !== accidentalBar) {
					accidentalBar = chord[0].bar;
					accidentalsSoFar = {};
				}

				var within = (chord[0].start % partsPerBar) / partsPerBar;
				var cx = x0 + barOnLine * BAR_W + 18 + within * (BAR_W - 28);
				var shape = durationGlyph(chord[0].duration, partsPerBeat);

				var heads = [];
				for (var hi = 0; hi < chord.length; hi++) {
					var sp = spell(chord[hi].midi, useSharps);
					heads.push({sp: sp, steps: sp.diatonic - bottomDiatonic});
				}
				heads.sort(function (a, b) { return a.steps - b.steps; });

				var minSteps = heads[0].steps;
				var maxSteps = heads[heads.length - 1].steps;
				// The note furthest from the middle line picks the direction, and a
				// tie goes stem-down, which is the usual convention.
				var up = (maxSteps - 4) < (4 - minSteps);
				var stemX = cx + (up ? 5 : -5);

				// Two notes a step apart cannot both sit on the same side of the
				// stem, so the upper one crosses over.
				for (var h = 0; h < heads.length; h++) {
					var prev = h > 0 ? heads[h - 1] : null;
					heads[h].offset = !!(prev && !prev.offset && heads[h].steps - prev.steps === 1);
					heads[h].x = cx + (heads[h].offset ? (up ? 10.8 : -10.8) : 0);
					heads[h].y = top + STAFF - heads[h].steps * GAP;
				}

				for (h = 0; h < heads.length; h++) {
					var head = heads[h];
					var L;
					for (L = -2; head.steps <= L; L -= 2) {
						el("line", {x1: head.x - 9, y1: top + STAFF - L * GAP, x2: head.x + 9,
							y2: top + STAFF - L * GAP, stroke: "#000", "stroke-width": 1}, svg);
					}
					for (L = 10; head.steps >= L; L += 2) {
						el("line", {x1: head.x - 9, y1: top + STAFF - L * GAP, x2: head.x + 9,
							y2: top + STAFF - L * GAP, stroke: "#000", "stroke-width": 1}, svg);
					}

					el("ellipse", {cx: head.x, cy: head.y, rx: 5.4, ry: 4,
						fill: shape.filled ? "#000" : "none",
						stroke: "#000", "stroke-width": shape.filled ? 0 : 1.4,
						transform: "rotate(-20 " + head.x + " " + head.y + ")"}, svg);

					// A dot belongs in a space, so one on a line rides just above it.
					if (shape.dotted) {
						el("circle", {cx: head.x + 10,
							cy: head.steps % 2 === 0 ? head.y - GAP : head.y,
							r: 1.6, fill: "#000"}, svg);
					}
				}

				if (shape.stem) {
					var yLow = top + STAFF - minSteps * GAP;    // lowest pitch, largest y
					var yHigh = top + STAFF - maxSteps * GAP;
					var y1 = up ? yLow : yHigh;
					var y2 = up ? yHigh - 26 : yLow + 26;
					el("line", {x1: stemX, y1: y1, x2: stemX, y2: y2,
						stroke: "#000", "stroke-width": 1.3}, svg);
					// Flags hang off the right of the stem either way, so a down-stem
					// flag is the up-stem one mirrored rather than the same curve.
					for (var fl = 0; fl < shape.flags; fl++) {
						var fy = y2 + fl * 6 * (up ? 1 : -1);
						el("path", {d: "M " + stemX + " " + fy + (up ? " q 9 4 7 13" : " q 9 -4 7 -13"),
							stroke: "#000", "stroke-width": 1.3, fill: "none"}, svg);
					}
				}

				// Accidentals stack into columns left of the chord so two of them
				// never land on top of each other.
				var accColumns = [];
				for (h = heads.length - 1; h >= 0; h--) {
					var staffSlot = heads[h].sp.diatonic;
					var written = heads[h].sp.accidental;
					var needed;
					if (accidentalsSoFar.hasOwnProperty(staffSlot)) {
						// Something already altered this line or space this measure,
						// so a mark is needed only if this note differs from it.
						needed = accidentalsSoFar[staffSlot] !== written;
					} else {
						needed = !isInKeySignature(heads[h].sp, sig);
					}
					if (!needed) continue;
					accidentalsSoFar[staffSlot] = written;
					var col = 0;
					while (col < accColumns.length && Math.abs(accColumns[col] - heads[h].y) < GAP * 2.2) col++;
					accColumns[col] = heads[h].y;
					glyph(svg, heads[h].x - 14 - col * 10, heads[h].y + 5,
						heads[h].sp.accidental === 1 ? "♯" : heads[h].sp.accidental === -1 ? "♭" : "♮", 14);
				}
			}

			// measure numbers
			for (var m = 0; m < barsHere; m++) {
				glyph(svg, x0 + m * BAR_W + 2, top - 6, String(line * PER_LINE + m + 1), 9, "#888");
			}
		}

		container.appendChild(svg);

		// getBBox only reports real numbers once the node is actually in the
		// document, and this container is still detached, so align on the next
		// frame - by then the caller has appended it.
		alignClefsLater(clefs);
		return container;
	}

	function alignClefsLater(clefs) {
		if (!clefs.length) return;
		var run = function () {
			for (var c = 0; c < clefs.length; c++) {
				var node = clefs[c].node, box;
				try { box = node.getBBox(); } catch (e) { continue; }
				if (!box || !box.height) continue;
				var anchorY = box.y + box.height * clefs[c].anchor;
				node.setAttribute("y", String(
					parseFloat(node.getAttribute("y")) + (clefs[c].lineY - anchorY)));
			}
		};
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
		else setTimeout(run, 0);
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
