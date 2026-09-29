// Output check for generateText: the outline from its first line that opens with a markdown heading or a bold title
// (leaked model thinking before it is cut), or null when there is no heading or no module content - the chain then
// tries the next model. A bold phrase inside a numbered/indented thinking line does not count as the start.
export function acceptOutline(text: string): string | null {
  if (!/^#{1,6} /m.test(text)) return null;
  const m = /^(#{1,6} |\*\*)/m.exec(text);
  if (!m) return null;
  const kept = text.slice(m.index).trim();
  return /module/i.test(kept) ? kept : null;
}
