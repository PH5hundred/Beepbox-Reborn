# Attribution

## BeepBox is not my software

This repository is a fork of **BeepBox**, created by **John Nesky**.

- Original project: https://github.com/johnnesky/beepbox
- Official site: https://www.beepbox.co
- Author: https://johnnesky.com/

The synthesizer, the song editor, the player, the song format and essentially
all of the architecture in this repository are John Nesky's work, together with
the contributors to that project. Copyright (c) 2012-2024 John Nesky and
contributing authors, released under the MIT license. The full license text is
in [LICENSE.md](LICENSE.md) and applies to this fork as well.

## What this fork is

An unofficial, independently maintained fork with some additions of its own:
nested repeat loops, measure and instrument-slot controls, a concert-key
readout aimed at concert band players, and extra instrument presets.

It is **not** affiliated with, endorsed by, sponsored by, or supported by John
Nesky. Please do not report problems with this fork to him, and please do not
assume that a bug found here exists in BeepBox itself.

If you want BeepBox — the real thing, maintained by the person who made it — go
to [beepbox.co](https://www.beepbox.co). If you find it valuable, the gratuity
link on the original project goes to its author, and that is where it belongs.

## Third-party dependencies

Dependencies are listed in [package.json](package.json) and retain their own
licenses. As upstream notes, BeepBox also has an indirect, optional dependency
on [lamejs](https://www.npmjs.com/package/lamejs) via
[jsDelivr](https://www.jsdelivr.com/), downloaded on demand when exporting an
.mp3 file.
