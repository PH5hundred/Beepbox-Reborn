# Beepbox: Reborn

**This is a fork. BeepBox is not my software.**

BeepBox is an online tool for sketching and sharing instrumental melodies. It was
created by [John Nesky](https://johnnesky.com/), it lives at
[beepbox.co](https://www.beepbox.co), and its source is at
[github.com/johnnesky/beepbox](https://github.com/johnnesky/beepbox). Every line of
the original synthesizer, editor and player is his work and the work of the
contributors to that project, released under the
[MIT license](LICENSE.md). Copyright (c) 2012-2024 John Nesky and contributing
authors.

This repository is an unofficial, independently maintained fork. It is **not**
affiliated with, endorsed by, or supported by John Nesky. Do not report problems
with this fork to him, and do not assume a bug here exists upstream. If you want
BeepBox itself — the real thing, maintained by its author — go to
[beepbox.co](https://www.beepbox.co).

See [NOTICE.md](NOTICE.md) for the full attribution statement.

If you find BeepBox valuable, the gratuity link on the original project goes to
its author, and that is where it should go.

## What this fork changes

The goal of this fork is more flexibility than upstream offers, in a few specific
directions. What is actually built so far:

### Nested repeat sections

Upstream has a single playback loop — the purple bar that loops a span of bars
indefinitely. This fork keeps that untouched and adds **repeat sections**: any
number of spans that each play through a set number of times and then move on,
the way a pair of repeat signs works in written music.

Sections may nest. An inner section completes all of its passes during every pass
of the section containing it, so this:

```
bar:   1  2  3  4  5  6
     [===== A ========]   A repeats once
        [= B =]           B repeats once
```

plays as `1 2 3 2 3 4 5 6`, then again from the top of A.

Repeat loops are drawn as their own colored bars beneath the playback loop, one
row per nesting level. They behave like the playback loop does:

- **drag across empty bars** to create a loop
- **drag a loop's middle** to move it
- **drag either end** to resize it
- **click** a loop to cycle how many times it repeats
- **alt-click** or **right-click** a loop to delete it

A move or resize that would leave a loop half-inside another is refused, so a
loop stays where you last put it legally rather than disappearing.

Partial overlap is rejected — a section either nests fully inside another or stays
clear of it, since anything else has no meaning in notation.

Songs that use repeat sections are specific to this fork. Songs that do not use
them still produce URLs that upstream BeepBox reads normally, and every existing
BeepBox URL still loads here.

### Measures you add on purpose

Upstream starts every song at 16 measures, so a new song opens with a row of
empty "0" measures you have to work around or shorten by hand. Here a new song
is only as long as the measures it actually uses, and the track editor ends with
**+ measure** and **- measure** buttons that append or drop one measure at a
time. Removing stops at one measure and the button greys out there.

The track area scrolls horizontally once the measures outgrow the visible width,
and the buttons stay reachable at the end.

Upstream's "Delete Selected Bars" in the Edit menu still works for removing
measures from the middle of a song; these buttons are for the common case of
adjusting the end.

### Instrument slots

Between the track rows and the loop bars there is a strip with **+ instrument**
and **- instrument**. Each slot is a channel: its own row in the track editor
with its own instrument. Adding stops at BeepBox's ceiling of 10 pitch channels
and removing stops at one, with the buttons greying out at each end. The strip
stays pinned to the left while the track scrolls sideways.

These buttons manage pitch slots. Noise/drum channels, and inserting a slot
somewhere other than the end, are still handled by the Edit menu as upstream
does it.

### More instruments

Two new preset categories at the end of the instrument menu:

**Marching Band** — marching trumpet, mellophone, marching trombone, baritone
horn, sousaphone, marching clarinet, alto and tenor saxophone, marching flute,
piccolo and glockenspiel on pitch channels; marching snare, bass drum line,
crash cymbals and quad toms on drum channels.

**Retro Synth** — megalo lead, hyper saw, determination pad, text blip, spooky
pulse, heartache bass, ruins bell, 8-bit choir, dog pluck, battle organ, warm
triangle bass and retro double saw.

Both categories are appended after upstream's, because a preset is stored in the
song URL as `(categoryIndex << 6) + presetIndex`. Inserting anywhere else would
silently change which instrument an existing song plays. Every one of upstream's
185 preset values is unchanged.

### Still planned

More flexible instruments, more flexible measures, and a sheet music generator.

## Compiling

The code is TypeScript and needs Node & npm
([install those first](https://nodejs.org/en/download)).

```
npm install
npm run build
```

## Code

The layout is unchanged from upstream.

The [synth/](synth) folder has just the code needed to play songs out loud. This
fork adds `synth/RepeatSections.ts`, which holds the repeat-section model and the
pass-counting that drives playback order. To rebuild just the synth:

```
npm run build-synth
```

The [editor/](editor) folder has the song editor interface. To rebuild just it:

```
npm run build-editor
```

The [player/](player) folder has a miniature player interface for embedding. To
rebuild just it:

```
npm run build-player
```

The [website/](website) folder contains the index.html files that load these
interfaces; the build outputs JavaScript there.

## Dependencies

Most dependencies are listed in [package.json](package.json). As upstream notes,
BeepBox also has an indirect, optional dependency on
[lamejs](https://www.npmjs.com/package/lamejs) via
[jsdelivr](https://www.jsdelivr.com/) for exporting .mp3 files, downloaded on
demand when the user exports an .mp3.
