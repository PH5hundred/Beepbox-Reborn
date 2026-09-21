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

	// A note running past a barline is written as two noteheads joined by a tie,
	// so split every chord at each barline it crosses.
	function buildEvents(notes, partsPerBar, partsPerBeat) {
		var chords = groupChords(notes);
		var events = [];
		for (var c = 0; c < chords.length; c++) {
			var chord = chords[c];
			var midis = [];
			for (var i = 0; i < chord.length; i++) midis.push(chord[i].midi);
			var pos = chord[0].start;
			var remaining = chord[0].duration;
			var previous = null;
			while (remaining > 0) {
				var barIndex = Math.floor(pos / partsPerBar);
				var untilBarline = (barIndex + 1) * partsPerBar - pos;
				var length = Math.min(remaining, untilBarline);
				var ev = {
					bar: barIndex, start: pos, duration: length, midis: midis,
					shape: durationGlyph(length, partsPerBeat),
					tieTo: null, tiedFrom: false,
				};
				if (previous !== null) { previous.tieTo = ev; ev.tiedFrom = true; }
				events.push(ev);
				previous = ev;
				pos += length;
				remaining -= length;
			}
		}
		events.sort(function (a, b) { return a.start - b.start; });
		return events;
	}

	// Flagged notes that run on from one another inside a single beat are beamed
	// as a group rather than each carrying its own flag.
	function beamGroups(events, partsPerBar, partsPerBeat) {
		var groups = [], current = null;
		for (var i = 0; i < events.length; i++) {
			var ev = events[i];
			var beat = Math.floor((ev.start % partsPerBar) / partsPerBeat);
			if (ev.shape.flags > 0 && ev.tieTo === null && !ev.tiedFrom) {
				var joins = current !== null && current.bar === ev.bar && current.beat === beat &&
					current.last.start + current.last.duration === ev.start;
				if (joins) {
					current.events.push(ev);
					current.last = ev;
				} else {
					current = {bar: ev.bar, beat: beat, events: [ev], last: ev};
					groups.push(current);
				}
			} else {
				current = null;
			}
		}
		var out = [];
		for (i = 0; i < groups.length; i++) {
			if (groups[i].events.length > 1) out.push(groups[i].events);
		}
		return out;
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
		var events = buildEvents(notes, partsPerBar, partsPerBeat);
		var beams = beamGroups(events, partsPerBar, partsPerBeat);

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

			// measure numbers
			for (var m = 0; m < barsHere; m++) {
				glyph(svg, x0 + m * BAR_W + 2, top - 6, String(line * PER_LINE + m + 1), 9, "#888");
			}
		}

		// --- notes, beams, ties and slurs -----------------------------------
		// One pass over the whole part rather than one per system, because a beam
		// or a tie has to reach between notes that a system boundary separates.
		function topOfBar(bar) {
			return TOP_PAD + above + Math.floor(bar / PER_LINE) * LINE_H;
		}
		function xOfEvent(ev) {
			var within = (ev.start % partsPerBar) / partsPerBar;
			return LEFT + (ev.bar % PER_LINE) * BAR_W + 18 + within * (BAR_W - 28);
		}
		function ledgerLine(x, top, L) {
			el("line", {x1: x - 9, y1: top + STAFF - L * GAP, x2: x + 9,
				y2: top + STAFF - L * GAP, stroke: "#000", "stroke-width": 1}, svg);
		}

		var ei, ev, h, k, head;

		for (ei = 0; ei < events.length; ei++) {
			ev = events[ei];
			var heads = [];
			for (var hi = 0; hi < ev.midis.length; hi++) {
				var spl = spell(ev.midis[hi], useSharps);
				heads.push({sp: spl, steps: spl.diatonic - bottomDiatonic});
			}
			heads.sort(function (a, b) { return a.steps - b.steps; });
			ev.heads = heads;
			ev.minSteps = heads[0].steps;
			ev.maxSteps = heads[heads.length - 1].steps;
			ev.cx = xOfEvent(ev);
			ev.top = topOfBar(ev.bar);
		}

		// A beamed group points all its stems the same way, so the direction has to
		// be settled for the group before any of its notes can be positioned.
		for (var gi = 0; gi < beams.length; gi++) {
			var group = beams[gi];
			var sum = 0;
			for (k = 0; k < group.length; k++) sum += (group[k].minSteps + group[k].maxSteps) / 2;
			var groupUp = (sum / group.length) < 4;
			for (k = 0; k < group.length; k++) {
				group[k].beamed = true;
				group[k].up = groupUp;
			}
		}

		for (ei = 0; ei < events.length; ei++) {
			ev = events[ei];
			if (ev.up === undefined) ev.up = (ev.maxSteps - 4) < (4 - ev.minSteps);
			ev.stemX = ev.cx + (ev.up ? 5 : -5);
			for (h = 0; h < ev.heads.length; h++) {
				var previousHead = h > 0 ? ev.heads[h - 1] : null;
				ev.heads[h].offset = !!(previousHead && !previousHead.offset &&
					ev.heads[h].steps - previousHead.steps === 1);
				ev.heads[h].x = ev.cx + (ev.heads[h].offset ? (ev.up ? 10.8 : -10.8) : 0);
				ev.heads[h].y = ev.top + STAFF - ev.heads[h].steps * GAP;
			}
			ev.yLow = ev.top + STAFF - ev.minSteps * GAP;
			ev.yHigh = ev.top + STAFF - ev.maxSteps * GAP;
		}

		// Ties and slurs first, so the curves pass behind the noteheads.
		for (ei = 0; ei < events.length; ei++) {
			ev = events[ei];
			if (ev.tieTo === null || ev.tieTo.top !== ev.top) continue;
			// A tie joins the same pitch, so it arcs from notehead to notehead on
			// the side away from the stems.
			var tieUp = !ev.up;
			var ya = tieUp ? ev.yHigh - 7 : ev.yLow + 7;
			var xa = ev.cx + 7, xb = ev.tieTo.cx - 7;
			if (xb - xa < 6) xb = xa + 6;
			el("path", {d: "M " + xa + " " + ya + " Q " + ((xa + xb) / 2) + " " +
				(ya + (tieUp ? -7 : 7)) + " " + xb + " " + ya,
				stroke: "#000", "stroke-width": 1.1, fill: "none"}, svg);
		}

		// A run of notes that touch with nothing between them is one legato
		// phrase. Ties break a run, since a tie already says "same note held".
		var runStart = 0;
		for (ei = 0; ei <= events.length; ei++) {
			var breaks = ei === events.length;
			if (!breaks) {
				var prev = events[ei - 1];
				// Kept inside one measure: a legato line can run the whole system,
				// and a single curve stretched over four bars reads as a mistake
				// rather than as phrasing.
				breaks = ei === 0 || prev.top !== events[ei].top ||
					prev.bar !== events[ei].bar ||
					prev.start + prev.duration !== events[ei].start ||
					prev.tieTo !== null || events[ei].tiedFrom;
			}
			if (breaks && ei - runStart > 1) {
				var first = events[runStart], last = events[ei - 1];
				var allSame = true;
				for (k = runStart + 1; k < ei; k++) {
					if (events[k].maxSteps !== first.maxSteps) { allSame = false; break; }
				}
				if (!allSame) {
					var slurUp = !first.up;
					var topmost = slurUp ? Infinity : -Infinity;
					for (k = runStart; k < ei; k++) {
						topmost = slurUp ? Math.min(topmost, events[k].yHigh)
						                 : Math.max(topmost, events[k].yLow);
					}
					var sy = topmost + (slurUp ? -12 : 12);
					el("path", {d: "M " + (first.cx) + " " + (slurUp ? first.yHigh - 9 : first.yLow + 9) +
						" Q " + ((first.cx + last.cx) / 2) + " " + (sy + (slurUp ? -6 : 6)) +
						" " + (last.cx) + " " + (slurUp ? last.yHigh - 9 : last.yLow + 9),
						stroke: "#000", "stroke-width": 1.1, fill: "none"}, svg);
				}
			}
			if (breaks) runStart = ei;
		}

		// Noteheads, ledger lines, dots and accidentals. An accidental holds for
		// the rest of its measure, so it is printed once and then remembered.
		var accidentalBar = -1, accidentalsSoFar = {};
		for (ei = 0; ei < events.length; ei++) {
			ev = events[ei];
			if (ev.bar !== accidentalBar) { accidentalBar = ev.bar; accidentalsSoFar = {}; }
			var shape = ev.shape;

			for (h = 0; h < ev.heads.length; h++) {
				head = ev.heads[h];
				var L;
				for (L = -2; head.steps <= L; L -= 2) ledgerLine(head.x, ev.top, L);
				for (L = 10; head.steps >= L; L += 2) ledgerLine(head.x, ev.top, L);

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

			// The second half of a tie repeats the notehead but not the accidental.
			if (ev.tiedFrom) continue;

			var accColumns = [];
			for (h = ev.heads.length - 1; h >= 0; h--) {
				var staffSlot = ev.heads[h].sp.diatonic;
				var written = ev.heads[h].sp.accidental;
				var needed;
				if (accidentalsSoFar.hasOwnProperty(staffSlot)) {
					needed = accidentalsSoFar[staffSlot] !== written;
				} else {
					needed = !isInKeySignature(ev.heads[h].sp, sig);
				}
				if (!needed) continue;
				accidentalsSoFar[staffSlot] = written;
				var col = 0;
				while (col < accColumns.length && Math.abs(accColumns[col] - ev.heads[h].y) < GAP * 2.2) col++;
				accColumns[col] = ev.heads[h].y;
				glyph(svg, ev.heads[h].x - 14 - col * 10, ev.heads[h].y + 5,
					written === 1 ? "♯" : written === -1 ? "♭" : "♮", 14);
			}
		}

		// Stems and flags for everything that is not beamed.
		for (ei = 0; ei < events.length; ei++) {
			ev = events[ei];
			if (ev.beamed || !ev.shape.stem) continue;
			var y1 = ev.up ? ev.yLow : ev.yHigh;
			var y2 = ev.up ? ev.yHigh - 26 : ev.yLow + 26;
			el("line", {x1: ev.stemX, y1: y1, x2: ev.stemX, y2: y2,
				stroke: "#000", "stroke-width": 1.3}, svg);
			// Flags hang off the right of the stem either way, so a down-stem flag
			// is the up-stem one mirrored rather than the same curve.
			for (var fl = 0; fl < ev.shape.flags; fl++) {
				var fy = y2 + fl * 6 * (ev.up ? 1 : -1);
				el("path", {d: "M " + ev.stemX + " " + fy + (ev.up ? " q 9 4 7 13" : " q 9 -4 7 -13"),
					stroke: "#000", "stroke-width": 1.3, fill: "none"}, svg);
			}
		}

		// Beamed groups: one shared beam, with every stem stretched to reach it.
		for (gi = 0; gi < beams.length; gi++) {
			group = beams[gi];
			var up = group[0].up;
			var beamY = up ? Infinity : -Infinity;
			for (k = 0; k < group.length; k++) {
				beamY = up ? Math.min(beamY, group[k].yHigh - 26)
				           : Math.max(beamY, group[k].yLow + 26);
			}
			for (k = 0; k < group.length; k++) {
				el("line", {x1: group[k].stemX, y1: up ? group[k].yLow : group[k].yHigh,
					x2: group[k].stemX, y2: beamY, stroke: "#000", "stroke-width": 1.3}, svg);
			}
			var mostFlags = 0;
			for (k = 0; k < group.length; k++) mostFlags = Math.max(mostFlags, group[k].shape.flags);
			for (var level = 0; level < mostFlags; level++) {
				var beamRowY = beamY + level * 5.5 * (up ? 1 : -1);
				// A sixteenth next to an eighth only gets the beams they share.
				for (k = 0; k < group.length - 1; k++) {
					if (group[k].shape.flags > level && group[k + 1].shape.flags > level) {
						el("line", {x1: group[k].stemX, y1: beamRowY,
							x2: group[k + 1].stemX, y2: beamRowY,
							stroke: "#000", "stroke-width": 3.2}, svg);
					}
				}
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
