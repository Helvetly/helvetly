/** Longest part of an answer a reply quotes; longer selections are cut with an ellipsis. */
export const MAX_QUOTE = 500

/** Tidies a selection from an answer into the quote a reply carries. */
export function toQuote(selection: string) {
  const lines = selection
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  return lines.length > MAX_QUOTE ? `${lines.slice(0, MAX_QUOTE).trimEnd()}…` : lines
}

/** The message sent for a reply: the quote as Markdown `> ` lines, then the question. */
export const withQuote = (quote: string, text: string) =>
  `${quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n${text}`

/** Splits a sent message back into its leading quote (if any) and the question. */
export function splitQuote(text: string): { quote?: string; body: string } {
  const match = /^(?:> .*(?:\n|$))+\n?/.exec(text)
  if (!match) return { body: text }
  const quote = match[0]
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(2))
    .join('\n')
  return { quote, body: text.slice(match[0].length) }
}
