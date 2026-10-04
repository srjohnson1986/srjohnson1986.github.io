# Adding a release to the Audio page

Each release is one data file here, for example `src/content/releases/my-album-artist.yaml`:

```yaml
title: "Album Title"
artist: "Artist Name"
year: 2026
kind: album               # album, ep, single, or split
roles: [engineered]       # optional: produced, engineered, mixed, mastered, wrote, performed
tags: [punk, pop-punk]    # genres, lowercase with hyphens
bandcamp: https://artist.bandcamp.com/album/album-title
embed: https://bandcamp.com/EmbeddedPlayer/album=1234567890/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=false/artwork=small/transparent=true/
embedHeight: 120          # optional: the height from the Bandcamp embed code (default 120)
```

To get the `embed` address, open the release on Bandcamp, choose Share / Embed, and copy the
address inside `src="..."` of the embed code. The build only accepts addresses that start with
`https://bandcamp.com/EmbeddedPlayer/`.

`roles` are the roles credited to the site owner on that release. Leave the line out when the
release lists none. Pages show the Bandcamp link at all times, and a visitor presses "Load
player" to load the player, so nothing is requested from Bandcamp until they ask.

The build checks every file and stops with a readable message if a field is missing, the embed
address is not a Bandcamp player, or the text contains an em dash, en dash, or double hyphen.
