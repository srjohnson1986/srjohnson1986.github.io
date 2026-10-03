// Site-wide facts used by layouts and the resume. Public site rules (see CLAUDE.md):
// no phone number, location is "Atlanta area" only, contact is email plus LinkedIn and GitHub.

export const site = {
  name: 'Steven Johnson',
  url: 'https://srjohnson1986.github.io',
  area: 'Atlanta area',
  // Published on the resume page and in the PDFs. Set to undefined to hide it.
  email: 'srjohnson1986@gmail.com' as string | undefined,
  links: {
    linkedin: { label: 'linkedin.com/in/stevegulls', href: 'https://www.linkedin.com/in/stevegulls' },
    github: { label: 'github.com/srjohnson1986', href: 'https://github.com/srjohnson1986' },
  },
};
