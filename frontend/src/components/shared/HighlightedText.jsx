import { highlightParts } from '../../utils/highlightTerm';

// Text with the searched word marked.
//
// Used by the office's minutes list and by the members' page, so a search result
// reads the same in both places: the word is there in the sentence it was found in,
// marked, rather than the reader being left to scan for it.
export default function HighlightedText({ text, term, className }) {
  return (
    <span className={className}>
      {highlightParts(text, term).map((part, index) =>
        part.match ? (
          <mark
            key={index}
            // Tailwind's `mark` default is a bright yellow that fights the page; the
            // group's own accent tint reads as "found here" without shouting.
            className="rounded bg-accent/25 px-0.5 text-ink"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  );
}
