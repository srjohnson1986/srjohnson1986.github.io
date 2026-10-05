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

`tags` is an optional list of labels on a piece, kept in the data so a filter on the Art page can be
built on them later. They are not shown on the site yet. Each tag is lowercase with single hyphens
(`five-hundred-bucks`, not `Five Hundred Bucks`), and a piece cannot list the same tag twice; the
build stops with a readable message otherwise. Reuse a tag exactly as spelled so pieces match.

Useful kinds of tag, so the names stay consistent: the **bands** on the flyer (`seagulls`), the
**venue** (`the-earl`), the **city** (`atlanta`), and the **technique** (`collage`,
`hand-lettered`, `photo-parody`).
