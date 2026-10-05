# Adding a piece to the Art page

Each piece is a data file here plus its image in `src/assets/art/`, sharing a short name, for
example `spring-showcase`:

1. The image, saved as `src/assets/art/spring-showcase.jpg`. Use the highest quality version
   you have. The build makes the smaller sizes.
2. A data file here, `src/content/art/spring-showcase.yaml`:

```yaml
title: Spring Showcase
year: 2026                  # optional: leave out when the year is not known
date: 2026.04.11            # optional: text shown instead of the year
order: 5                    # optional: breaks a tie between pieces with the same date (lower first)
medium: show-flyer          # show-flyer, illustration, or other
format: poster-11x17        # optional: poster-11x17, square, or social
image: ../../assets/art/spring-showcase.jpg
alt: >-
  Describe what the artwork looks like, as you would to someone who cannot see it.
caption: Optional short text, shown under "Read more".
tags: [five-hundred-bucks, the-earl, collage]   # optional: labels for filtering later; not shown yet
story:                      # optional: paragraphs behind the expand and collapse control
  - First paragraph of the story behind the piece.
  - Second paragraph, if there is one.
more:                       # optional: further images for a series, shown inside the control
  - image: ../../assets/art/spring-showcase-2.jpg
    alt: Describe the second image.
    caption: Optional caption for it.
```

A piece with a story or further images gets an expand and collapse control. Pieces are ordered
newest first by their date, so a new piece needs no `order` number to land in the right place. The
date is read from the numbers at the start of `date` (`2026.02.13`, `2025.10`, or a range like
`2024.08.02-04`, which counts as the 2nd). A piece with only a year, or a date like `Summer 2025`,
comes after the dated pieces of that year, and a piece with no year comes last. `order` only
settles pieces that share a date.

The build checks every file. It stops with a readable message if a field is missing, an image
cannot be found, the alt text is missing or too short, or the text contains an em dash, en dash,
or double hyphen.

## Tags

`tags` is an optional list of labels on a piece. They become the Tags choices in the Filters panel
on the Art page, which appears as soon as one piece has a tag (a visitor who picks several tags sees
only the pieces that have all of them). The tags are not printed on the cards. Each tag is lowercase
with single hyphens (`five-hundred-bucks`, not `Five Hundred Bucks`), and a piece cannot list the
same tag twice; the build stops with a readable message otherwise. Reuse a tag exactly as spelled so
pieces match, since a misspelling makes a second choice in the panel.

Useful kinds of tag, so the names stay consistent: the **bands** on the flyer (`seagulls`), the
**venue** (`the-earl`), the **city** (`atlanta`), and the **technique** (`collage`,
`hand-lettered`, `photo-parody`).

## The Filters panel

The Art page has the same collapsible Filters panel as Audio and Development. Everything in it is
built from the pieces, so there is nothing to keep up to date by hand:

- **Sort by** flips the page between newest first (the default) and oldest first.
- **Year** lists the `year` of every piece, newest first.
- **Format** lists the `format` values in use (11x17 poster, Square, Social media). A piece with no
  `format` shows under "Any format" but not under a particular one.
- **Tags** lists every tag in use, with how many pieces have it (see Tags above).

The choices are kept in the web address (`/art/?year=2025&format=square&sort=oldest`), so a
filtered view can be shared. Without JavaScript the panel is hidden and the whole gallery shows,
newest first.
