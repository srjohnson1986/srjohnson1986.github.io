# Adding a piece to the Art page

Each piece is a data file here plus its image in `src/assets/art/`, sharing a short name, for
example `spring-showcase`:

1. The image, saved as `src/assets/art/spring-showcase.jpg`. Use the highest quality version
   you have. The build makes the smaller sizes.
2. A data file here, `src/content/art/spring-showcase.yaml`:

```yaml
title: Spring Showcase
year: 2026                  # optional: leave out when the year is not known
date: 2026.04.11            # optional: shown instead of the year, and sets the order (needs year)
order: 5                    # optional: breaks a tie between pieces with the same date (lower first)
medium: show-flyer          # show-flyer, illustration, or other
format: poster-11x17        # optional: poster-11x17, square, or social
image: ../../assets/art/spring-showcase.jpg
alt: >-
  Describe what the artwork looks like, as you would to someone who cannot see it.
caption: Optional short text, shown under "Read more".
bands: [five-hundred-bucks, seagulls]   # optional: the bands on the flyer, for filtering
venues: [the-earl]          # optional: the venue, for filtering
tags: [collage]             # optional: anything else, such as the technique, for filtering
story:                      # optional: paragraphs behind the expand and collapse control
  - First paragraph of the story behind the piece.
  - Second paragraph, if there is one.
more:                       # optional: further images for a series, shown inside the control
  - image: ../../assets/art/spring-showcase-2.jpg
    alt: Describe the second image.
    caption: Optional caption for it.
```

A piece with a story or further images gets an expand and collapse control. Pieces are ordered
newest first by their date, so a new piece needs no `order` number to land in the right place. Write
the date as `2026`, `2026.02`, `2026.02.13`, or a range inside one month like `2024.08.02-04` (which
counts as the 2nd). A piece with only a year comes after the dated pieces of that year, and a piece
with no year comes last. `order` only settles pieces that share a date.

The build checks every file. It stops with a readable message if a field is missing, an image
cannot be found, the alt text is missing or too short, the text contains an em dash, en dash, or
double hyphen, or the date is in another format, has an impossible month or day, a range that ends
before it starts, or a year that differs from `year`. That keeps the page in date order.

## Bands, venues, and tags

Three optional lists on a piece say what it is about, so the Filters panel can find it:

- `bands`: the bands on the flyer (`seagulls`, `five-hundred-bucks`)
- `venues`: where the show was (`boggs`, `the-earl`, `529`)
- `tags`: anything else, such as the technique (`collage`, `hand-lettered`, `photo-parody`) or the city

They are kept apart so a file is easy to edit: you always know which list a name goes in. On the page
they appear together as one **Tags** group, and a visitor who picks several sees the pieces that have
any of them. The group appears as soon as one piece has a name in any of the lists, and the names are
not printed on the cards.

Each name is lowercase with single hyphens (`five-hundred-bucks`, not `Five Hundred Bucks`). The build
stops with a readable message if a name is not written that way or is listed twice on one piece, even
across two lists. Reuse a name exactly as spelled so pieces match, since a misspelling makes a second
choice in the panel. A number like `529` can be written with or without quotes.

### How a name reads on the page

The Filters panel shows `five-hundred-bucks` as "Five Hundred Bucks". Without any extra work a name
reads with its hyphens turned into spaces (`the-earl` becomes "the earl"). To show it properly, add a
line for it in the `TAG_LABELS` list in `src/lib/projects.ts`, for example `ortliebs: "Ortlieb's"`. That
list is shared with Audio and Development, which is fine because each page only shows its own tags.

## The Filters panel

The Art page has the same collapsible Filters panel as Audio and Development. Everything in it is
built from the pieces, so there is nothing to keep up to date by hand:

- **Sort by** flips the page between newest first (the default) and oldest first.
- **Year** lists the `year` of every piece, newest first.
- **Format** lists the `format` values in use (11x17 poster, Square, Social media). A piece with no
  `format` shows under "Any format" but not under a particular one.
- **Tags** lists every band, venue, and tag in use (bands first, then venues, then tags), with how many
  pieces have it. A piece shows when it has any of the ones picked.

The choices are kept in the web address (`/art/?year=2025&format=square&sort=oldest`), so a
filtered view can be shared. Without JavaScript the panel is hidden and the whole gallery shows,
newest first.
