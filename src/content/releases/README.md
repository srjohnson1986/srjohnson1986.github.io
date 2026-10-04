# Adding a release to the Audio page

Each release is one data file here, for example `src/content/releases/my-album-artist.yaml`:

```yaml
title: "Album Title"
artist: "Artist Name"
bands: ["Artist Name"]  # optional: the bands it is filed under in the Band dropdown (see below)
year: 2026
type: album               # album, ep, single, or split
roles: [engineered]       # optional: produced, engineered, mixed, mastered, wrote, performed
tags: [punk, pop-punk]    # genres, lowercase with hyphens
bandcamp: https://artist.bandcamp.com/album/album-title
embed: https://bandcamp.com/EmbeddedPlayer/album=1234567890/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=false/artwork=small/transparent=true/
embedHeight: 120          # optional: the height from the Bandcamp embed code (default 120)
```

To get the `embed` address, open the release on Bandcamp, choose Share / Embed, and copy the
address inside `src="..."` of the embed code. The build only accepts addresses that start with
`https://bandcamp.com/EmbeddedPlayer/`.

`bands` is only needed when a release belongs to more than one band, such as a split: list each
band, and the release shows up when either is picked in the Band dropdown. Otherwise the dropdown
files the release under its `artist`.

`roles` are the roles credited to the site owner on that release. Leave the line out when the
release lists none. Each release shows its Bandcamp player. The player is drawn from the colors in
its address, so the page builds a light copy (the address as given) and a dark copy (dark
background and the site's accent color), and CSS shows the one that matches the theme. The hidden
copy is lazy, so the browser never requests it. The `bandcamp` page address is kept as a record of
where the release lives and is not shown on the page.

The build checks every file and stops with a readable message if a field is missing, the embed
address is not a Bandcamp player, or the text contains an em dash, en dash, or double hyphen.
