// The plain user message the eval sends: the description of the work and nothing else. It is its own file
// so the retrieval code can build on it without importing the runner.

export const userMessage = (prompt) => `Write one resume bullet for this work:\n\n${prompt.input}`;
