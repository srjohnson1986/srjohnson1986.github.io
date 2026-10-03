// Site-wide facts used by layouts and the resume. Public site rules (see CLAUDE.md):
// no phone number, location is "Atlanta area" only, contact is email plus LinkedIn and GitHub.

export interface NavItem {
  label: string;
  href: string;
}

export interface EntryCard {
  title: string;
  blurb: string;
  /** Leave unset while the destination page is not built yet. The card then shows "Coming soon". */
  href?: string;
}

export const site = {
  name: 'Steven Johnson',
  url: 'https://srjohnson1986.github.io',
  repo: 'https://github.com/srjohnson1986/srjohnson1986.github.io',
  area: 'Atlanta area',
  // Photo for the Home page. Leave undefined to show a placeholder. To use a real photo, put the
  // file in public/images/ and set { src: '/images/<file>', alt: '<description of the photo>' }.
  photo: undefined as { src: string; alt: string } | undefined,
  // Published on the resume page and in the PDFs. Set to undefined to hide it.
  email: 'srjohnson1986@gmail.com' as string | undefined,
  links: {
    linkedin: { label: 'linkedin.com/in/stevegulls', href: 'https://www.linkedin.com/in/stevegulls' },
    github: { label: 'github.com/srjohnson1986', href: 'https://github.com/srjohnson1986' },
  },
};

// Main navigation. Add an entry when a page ships; never link a page that is not built.
// With seven items the bar wraps on phones. The plan is to move Audio, Art, and Events under a
// "Creative" group there.
export const nav: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Resume', href: '/resume/' },
  { label: 'Development', href: '/development/' },
  { label: 'Audio', href: '/audio/' },
  { label: 'Art', href: '/art/' },
  { label: 'Events', href: '/events/' },
  { label: 'Contact', href: '/contact/' },
];

// The three entry points on the Home page. A card without an href shows "Coming soon".
export const entryCards: EntryCard[] = [
  {
    title: 'Technology and QA',
    blurb: 'Apps, tools, and sites I have built, with the code and live demos.',
    href: '/development/',
  },
  {
    title: 'Audio',
    blurb: 'Kingdom Hell, my home studio: production and engineering for other artists.',
    href: '/audio/',
  },
  {
    title: 'Art',
    blurb: 'Show flyers and other work made in Procreate.',
    href: '/art/',
  },
];
