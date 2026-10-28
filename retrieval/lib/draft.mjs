// Builds what is sent to the model for one draft: the writing rules (the system prompt, unchanged) and a
// message that holds the description and, when retrieval found any, a labelled block of reference examples.

import { SYSTEM_PROMPT } from '../../evals/resume-bullets/run.mjs';
import { retrieve } from './retrieve.mjs';
import { groundedMessage } from './grounding.mjs';
import { memoryBlock } from './memory.mjs';

// Re-exported so callers can keep importing the block's wording from here.
export { EXAMPLES_HEADING, EXAMPLES_INSTRUCTION, groundedMessage } from './grounding.mjs';

/**
 * Retrieves (unless turned off) and builds the prompt. Drafting never depends on retrieval: any failure or
 * empty result gives the plain message and a `fallback` reason.
 * @param {{ input: string, index: { items: object[] }, embed: Function, retrieval?: boolean, memory?: { avoid: string[], preferred: string[] }, k?: number, minScore?: number, log?: (s: string) => void }} args
 *   `memory` is the output of signals() in memory.mjs: rejected opening verbs and accepted bullets.
 * @returns {Promise<{ system: string, user: string, sources: { id: string, text: string, score: number }[], fallback: string | null }>}
 */
export async function prepareDraft({ input, index, embed, retrieval = true, memory, k, minScore, log }) {
  // The memory block goes last. With no memory it is empty and adds nothing, not even a blank line.
  const withMemory = (message) => {
    const block = memory ? memoryBlock(memory) : '';
    return block ? `${message}\n\n${block}` : message;
  };
  if (!retrieval) return { system: SYSTEM_PROMPT, user: withMemory(groundedMessage(input, [])), sources: [], fallback: 'retrieval turned off' };
  const { results, fallback } = await retrieve({ query: input, index, embed, k, minScore, log });
  return { system: SYSTEM_PROMPT, user: withMemory(groundedMessage(input, results)), sources: results, fallback };
}
