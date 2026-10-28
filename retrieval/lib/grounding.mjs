// The "Reference examples" block that retrieval adds to the user message. It is separate from draft.mjs
// so the bullet eval can use it without importing the runner (and the runner without importing it back).

import { userMessage } from '../../evals/resume-bullets/message.mjs';

export const EXAMPLES_HEADING = 'Reference examples';

// Said once, to the model, right under the heading. The point is style, not content. The last two sentences
// were added after the first live run with retrieval (see the README, "The first run with retrieval"): many
// approved bullets end in a clause about the result or purpose, and the drafts copied that shape even when
// the description gave none. They deliberately name no example clause, so they do not hand the model one.
export const EXAMPLES_INSTRUCTION =
  'These are approved bullets from the same resume, found because they are close in meaning to the work above. Match their style, tone, and level of detail. Never copy an example\'s facts, numbers, tools, or wording: use only what the description above says, and write the bullet in your own words. Many examples end with a clause about the result or purpose of the work. Do not add a result, purpose, or benefit of your own unless the description states it; if it states none, stop after saying what was done.';

/**
 * The user message. With no examples it is exactly the message the eval sends, so a draft without
 * retrieval is the same request as before.
 * @param {string} input the description of the work
 * @param {{ text: string }[]} examples
 */
export function groundedMessage(input, examples) {
  const base = userMessage({ input });
  if (!examples.length) return base;
  const list = examples.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
  return `${base}\n\n${EXAMPLES_HEADING}\n\n${EXAMPLES_INSTRUCTION}\n\n${list}`;
}
