// Site-wide facts used by layouts and the resume. Public site rules (see CLAUDE.md):
// no phone number, location is "Decatur, GA" (with "a suburb of Atlanta" in page text; the owner chose to publish the city), no street
// address, contact is email plus LinkedIn and GitHub.

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
  // Filled into {area} in page text, such as "I am based in {area}."
  area: 'Decatur, GA, a suburb of Atlanta',
  // The short form, shown in the header of every resume page, print route, and PDF.
  resumeArea: 'Decatur, GA',
  // Shown before the area in the header of every resume page, print route, and PDF.
  resumePronouns: 'He/Him',
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
// An item with `children` is a section: its own page, plus the pages under it. (The projects under
// Development & QA are not listed here: withProjectPages below adds them from the project files.) On wide screens the
// section opens a list of its pages on hover or focus, and in the phone menu its pages are listed
// under it. On phones the links move into a Menu button, because the row would otherwise wrap.
export const nav: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Resume', href: '/resume/' },
  { label: 'Development & QA', href: '/development-qa/' },
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

/** Every page in a navigation as one flat list: each section followed by its pages. */
export const flattenNav = (items: NavItem[]): NavItem[] => items.flatMap((item) => [item, ...(item.children ?? [])]);

/**
 * The navigation with a page for each project under Development & QA. The projects come from the project
 * files (their `navTitle`), in the order the Development & QA page lists them, so a new project shows up
 * in the header and the phone menu with no change here. The header, the 404 page, and the tests all
 * build the navigation through this one function.
 */
export const withProjectPages = (items: NavItem[], projects: { id: string; navTitle: string }[]): NavItem[] =>
  items.map((item) =>
    item.href === '/development-qa/' ? { ...item, children: projects.map((p) => ({ label: p.navTitle, href: `/development-qa/${p.id}/` })) } : item,
  );
