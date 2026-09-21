// Marking the word that was searched for.
//
// Both places that show a result — the office's minutes list and the members' one —
// emphasise the term the reader typed, in the title and in the sentence the server
// found it in. The text is split into parts rather than turned into HTML, so the
// emphasised thing is always a piece of a text node: nothing a minute contains can
// become the marked-up part.
export function highlightParts(text, term) {
  const haystack = String(text ?? '');
  const needle = String(term ?? '').trim();
  if (!needle) return [{ text: haystack, match: false }];

  // The term is escaped and matched case-insensitively, exactly as the server does
  // it, so what is highlighted is what was found. A regex also keeps the indices in
  // step in a way that lowercasing both sides does not: `İ`.toLowerCase() is two
  // characters, which would slice the text in the wrong place.
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const parts = [];
  let last = 0;
  let hit = pattern.exec(haystack);

  while (hit) {
    if (hit.index > last) parts.push({ text: haystack.slice(last, hit.index), match: false });
    parts.push({ text: hit[0], match: true });
    last = hit.index + hit[0].length;
    hit = pattern.exec(haystack);
  }

  // Nothing to mark (or a term longer than the text): the whole thing is the text.
  if (!parts.length) return [{ text: haystack, match: false }];
  if (last < haystack.length) parts.push({ text: haystack.slice(last), match: false });
  return parts;
}
