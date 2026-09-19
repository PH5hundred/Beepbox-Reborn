// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// A repeat section marks a span of bars that plays more than once before the
// playhead moves on, like a pair of repeat signs in written music. Sections may
// nest: an inner section completes all of its passes during every pass of the
// section containing it. Partial overlap is not a thing you can express in
// notation and is rejected here.

export interface RepeatSectionSpec {
	start: number;
	length: number;
	repeatCount: number;
}

export class RepeatSection {
	public start: number;
	public length: number;
	// Extra passes beyond the first, so 1 means the span is heard twice.
	public repeatCount: number;

	constructor(start: number, length: number, repeatCount: number = 1) {
		this.start = start;
		this.length = length;
		this.repeatCount = repeatCount;
	}

	public get end(): number {
		return this.start + this.length;
	}

	public containsBar(bar: number): boolean {
		return bar >= this.start && bar < this.end;
	}

	public containsSection(other: RepeatSection): boolean {
		return other.start >= this.start && other.end <= this.end;
	}

	public strictlyContainsSection(other: RepeatSection): boolean {
		return this.containsSection(other) && this.length > other.length;
	}

	public overlapsPartially(other: RepeatSection): boolean {
		const intersects: boolean = this.start < other.end && other.start < this.end;
		return intersects && !this.containsSection(other) && !other.containsSection(this);
	}

	public copy(): RepeatSection {
		return new RepeatSection(this.start, this.length, this.repeatCount);
	}
}

// Owns the per-section pass counters and answers the only question playback
// actually needs: given the bar that just finished, which bar comes next?
export class RepeatTracker {
	private _sections: RepeatSection[] = [];
	private _passesTaken: number[] = [];

	public setSections(sections: readonly RepeatSection[]): void {
		// Outermost first, so a scan for "the innermost section ending here"
		// can simply take the last match.
		this._sections = sections.slice().sort((a, b) => {
			if (a.start != b.start) return a.start - b.start;
			return b.length - a.length;
		});
		this.reset();
	}

	public get sections(): readonly RepeatSection[] {
		return this._sections;
	}

	public reset(): void {
		this._passesTaken = this._sections.map(() => 0);
	}

	// The bar that follows `bar`, or -1 when no repeat section applies and the
	// caller should fall back to its own logic. Leaves counters untouched, so
	// it is safe for the synthesizer's note-continuation lookahead.
	public peekNextBar(bar: number): number {
		const jumpIndex: number = this._findJumpIndex(bar + 1);
		return jumpIndex == -1 ? -1 : this._sections[jumpIndex].start;
	}

	// Same answer as peekNextBar, but records the pass so the section is
	// eventually allowed to fall through. Call once per bar actually played,
	// never for lookahead.
	public advancePastBar(bar: number): number {
		const candidate: number = bar + 1;
		const jumpIndex: number = this._findJumpIndex(candidate);

		if (jumpIndex == -1) {
			this._resetSectionsNotContaining(candidate);
			return -1;
		}

		const target: RepeatSection = this._sections[jumpIndex];
		this._passesTaken[jumpIndex]++;
		for (let i: number = 0; i < this._sections.length; i++) {
			if (i != jumpIndex && target.strictlyContainsSection(this._sections[i])) {
				this._passesTaken[i] = 0;
			}
		}
		return target.start;
	}

	private _findJumpIndex(candidate: number): number {
		let jumpIndex: number = -1;
		for (let i: number = 0; i < this._sections.length; i++) {
			const section: RepeatSection = this._sections[i];
			if (section.end != candidate) continue;
			if (this._passesTaken[i] >= section.repeatCount) continue;
			// Sorted outermost-first, so later matches are nested deeper.
			jumpIndex = i;
		}
		return jumpIndex;
	}

	private _resetSectionsNotContaining(bar: number): void {
		for (let i: number = 0; i < this._sections.length; i++) {
			if (!this._sections[i].containsBar(bar)) this._passesTaken[i] = 0;
		}
	}
}

// Drops sections that fall outside the song and any section that partially
// overlaps one already kept, so the rest of the engine can assume a clean tree.
export function sanitizeRepeatSections(sections: readonly RepeatSection[], barCount: number): RepeatSection[] {
	const kept: RepeatSection[] = [];
	for (const section of sections) {
		if (section.length < 1 || section.repeatCount < 1) continue;
		if (section.start < 0 || section.end > barCount) continue;
		if (kept.some(other => other.overlapsPartially(section))) continue;
		kept.push(section.copy());
	}
	return kept;
}

// How deeply a section sits inside the others, used to pick its colour and to
// inset its box in the editor.
export function getRepeatSectionDepth(sections: readonly RepeatSection[], index: number): number {
	const target: RepeatSection = sections[index];
	let depth: number = 0;
	for (let i: number = 0; i < sections.length; i++) {
		if (i != index && sections[i].strictlyContainsSection(target)) depth++;
	}
	return depth;
}
