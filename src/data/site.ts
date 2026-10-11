// Site-wide facts used by layouts and the resume. Public site rules (see CLAUDE.md):
// no phone number, location is "Atlanta area" only, contact is email plus LinkedIn and GitHub.

export interface NavItem {
  label: string;
  href: string;
  /** Pages that belong under this one. On wide screens they open in a list when the link is hovered
   *  or focused, and in the phone menu they are listed under it. The item's own page still exists. */
  children?: NavItem[];
}

export const site = {
  name: 'Steve Johnson',
  url: 'https://srjohnson1986.github.io',
  repo: 'https://github.com/srjohnson1986/srjohnson1986.github.io',
  area: 'Atlanta area',
  // Photo for the Home page. Leave undefined to show a placeholder. To use a real photo, put the
  // file in public/images/ and set { src: '/images/<file>', alt: '<description of the photo>' }.
  photo: {
    src: '/images/steve.jpg',
    alt: 'A smiling, handsome man dressed appreciably nice says hello. Did I mention how handsome he was?',
  } as { src: string; alt: string } | undefined,
  // Published on the resume page and in the PDFs. Set to undefined to hide it.
  email: 'srjohnson1986@gmail.com' as string | undefined,
  links: {
    linkedin: { label: 'linkedin.com/in/stevegulls', href: 'https://www.linkedin.com/in/stevegulls' },
    github: { label: 'github.com/srjohnson1986', href: 'https://github.com/srjohnson1986' },
  },
};

// Main navigation. Add an entry when a page ships; never link a page that is not built.
// An item with `children` is a section: its own page, plus the pages under it. On wide screens the
// section opens a list of its pages on hover or focus, and in the phone menu its pages are listed
// under it. On phones the links move into a Menu button, because the row would otherwise wrap.
export const nav: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Resume', href: '/resume/' },
  { label: 'Development', href: '/development/' },
  {
    label: 'Creative',
    href: '/creative/',
    children: [
      { label: 'Audio', href: '/audio/' },
      { label: 'Art', href: '/art/' },
      { label: 'Jabroni Fest', href: '/jabroni-fest/' },
    ],
  },
  { label: 'Contact', href: '/contact/' },
];

/** Every page in the navigation as one flat list: each section followed by its pages. */
export const navPages: NavItem[] = nav.flatMap((item) => [item, ...(item.children ?? [])]);
