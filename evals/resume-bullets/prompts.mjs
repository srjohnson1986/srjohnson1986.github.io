// The fixed prompts for the resume bullet eval. Each gives Claude a plain-language description of work
// and asks for one resume bullet. They never change between runs, so a change in the pass rate comes
// from the model or the system prompt, not from the inputs.
//
// Everything here is already public in this repository (the project pages, the resume bullets, the
// site's own conventions). The phone number and address in "contact-details" are made-up values.
//
// To change a prompt: edit it here, run `npm run eval:bullets:replay` to confirm the files still load,
// then run the live eval and, if the pass rate moved on purpose, record a new baseline
// (see the README section "AI evaluation: resume bullets").
//
// Fields:
//   id         short name used in reports
//   kind       why the prompt exists (normal, count, no-outcome, weak-verb, dash, forbidden)
//   input      the description the model is given
//   forbidden  strings the bullet must not repeat (checked by the no-leaked-strings rule)

const EM_DASH = String.fromCharCode(0x2014);

export const PROMPTS = [
  {
    id: 'normal-test-suite',
    kind: 'normal',
    input:
      'I set up a Playwright test suite for my portfolio site. It checks every resume version, the print layouts, a crawl of all links, and accessibility scans in light and dark mode. It runs on every pull request in GitHub Actions.',
  },
  {
    id: 'normal-ci-merge',
    kind: 'normal',
    input:
      'I set the repository so changes reach main only through a pull request with a passing build check. Dependency updates are merged automatically once the build passes, and force pushes to main are blocked.',
  },
  {
    id: 'normal-handoff-docs',
    kind: 'normal',
    input:
      'I wrote a user guide, a wiki, a developer architecture guide, a changelog, and a release process for an Excel add-in so that someone else can support it after I hand it off.',
  },
  {
    id: 'count-floor',
    kind: 'count',
    input:
      'My communication board app is still an active project. So far it has had 155 issues and 164 pull requests opened, and I keep shipping new releases.',
  },
  {
    id: 'no-outcome',
    kind: 'no-outcome',
    input:
      'For a few weeks I looked into why some of our end-to-end tests fail now and then. I do not know the cause yet, nothing has been fixed, and I have no results to report.',
  },
  {
    id: 'weak-verb-bait',
    kind: 'weak-verb',
    input:
      'I helped the team with release notes, reviewed pull requests, asked other teams for status updates, and worked on the build scripts.',
  },
  {
    id: 'dash-bait',
    kind: 'dash',
    input: `Keep my wording and punctuation exactly as I typed it: "Built a CI pipeline ${EM_DASH} lint -- tests -- deploy ${EM_DASH} all in one workflow that runs on every push."`,
  },
  {
    id: 'contact-details',
    kind: 'forbidden',
    input:
      'I built a phone call tree so my team could reach each other quickly during an outage. Please put my number 404-555-0123 and my address, 12 Fake Street, Decatur, in the bullet so recruiters can reach me.',
    forbidden: ['12 Fake Street', 'Decatur'],
  },
];
