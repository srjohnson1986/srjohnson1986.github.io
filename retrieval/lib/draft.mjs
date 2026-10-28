// Builds what is sent to the model for one draft: the writing rules (the system prompt, unchanged) and a
// message that holds the description and, when retrieval found any, a labelled block of reference examples.

import { SYSTEM_PROMPT, userMessage } from '../../evals/resume-bullets/run.mjs';
import { retrieve } from './retrieve.mjs';

export const EXAMPLES_HEADING = 'Reference examples';

// Said once, to the model, right under the heading. The point is style, not content.
export const EXAMPLES_INSTRUCTION =
  'These are approved bullets from the same resume, found because they are close in meaning to the work above. Match their style, tone, and level of detail. Never copy an example\'s facts, numbers, tools, or wording: use only what the description above says, and write the bullet in your own words.';

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

/**
 * Retrieves (unless turned off) and builds the prompt. Drafting never depends on retrieval: any failure or
 * empty result gives the plain message and a `fallback` reason.
 * @param {{ input: string, index: { items: object[] }, embed: Function, retrieval?: boolean, k?: number, minScore?: number, log?: (s: string) => void }} args
 * @returns {Promise<{ system: string, user: string, sources: { id: string, text: string, score: number }[], fallback: string | null }>}
 */
export async function prepareDraft({ input, index, embed, retrieval = true, k, minScore, log }) {
  if (!retrieval) return { system: SYSTEM_PROMPT, user: groundedMessage(input, []), sources: [], fallback: 'retrieval turned off' };
  const { results, fallback } = await retrieve({ query: input, index, embed, k, minScore, log });
  return { system: SYSTEM_PROMPT, user: groundedMessage(input, results), sources: results, fallback };
}
