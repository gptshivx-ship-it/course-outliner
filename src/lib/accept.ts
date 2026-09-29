// Output check for generateText: the outline from its first markdown heading on (leaked model thinking before it is
// cut), or null when there is no heading or no module content after it - the chain then tries the next model.
export function acceptOutline(text: string): string | null {
  const m = /^#{1,6} /m.exec(text);
  if (!m) return null;
  const kept = text.slice(m.index).trim();
  return /module/i.test(kept) ? kept : null;
}
