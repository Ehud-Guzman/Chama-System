// The opening words of a minute, for a row in the browse list. A search result shows
// the sentence the word was found in instead (the server sends it), because that is
// what says why the minute is a result.
export function openingOf(minute) {
  if (!minute?.content) return '';
  return `${minute.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}…`;
}
