# Adding a piece to the Art page

Each piece is two files that share a short name, for example `spring-showcase`:

1. The image, saved in `src/assets/art/`, for example `src/assets/art/spring-showcase.jpg`.
   Use the highest quality version you have. The build makes the smaller sizes.
2. A data file here, `src/content/art/spring-showcase.yaml`:

```yaml
title: Spring Showcase
year: 2026
medium: show-flyer          # show-flyer, illustration, or other
format: poster-11x17        # optional: poster-11x17, square, or social
image: ../../assets/art/spring-showcase.jpg
alt: >-
  Describe what the artwork looks like, as you would to someone who cannot see it.
caption: One short line shown under the image.
story:                      # optional. A piece with a story gets an expand and collapse control.
  - First paragraph of the story behind the piece.
  - Second paragraph, if there is one.
```

The build checks every file. It stops with a readable message if a field is missing, the image
cannot be found, the alt text is missing or too short, or the text contains an em dash, en dash,
or double hyphen.
