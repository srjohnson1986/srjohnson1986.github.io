// Site-wide facts used by layouts and the resume. Public site rules (see CLAUDE.md):
// no phone number, location is "Atlanta area" only, contact is email plus LinkedIn and GitHub.

export const site = {
  name: 'Steven Johnson',
  url: 'https://srjohnson1986.github.io',
  area: 'Atlanta area',
  // Left unset on purpose: no email address is published until one is chosen.
  email: undefined as string | undefined,
  links: {
    linkedin: { label: 'linkedin.com/in/stevegulls', href: 'https://www.linkedin.com/in/stevegulls' },
    github: { label: 'github.com/srjohnson1986', href: 'https://github.com/srjohnson1986' },
  },
};
