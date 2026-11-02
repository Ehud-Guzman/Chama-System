import { useState } from 'react';
import { shortDate } from '../../utils/format';

export function ClauseBody({ blocks }) {
  return (
    <div className="constitution-clause-body">
      {blocks.map((block, index) => {
        if (block.type === "p") {
          return <p key={index}>{block.text}</p>;
        }

        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ol>
          );
        }

        return null;
      })}
    </div>
  );
}

/*
 * ---------------------------------------------------------
 * CHAPTER DECISION
 * ---------------------------------------------------------
 * A member's own verdict on one chapter: approve, or reject with a reason.
 *
 * It is recorded once. The API refuses a second decision for the same chapter,
 * so once one exists this renders as a record rather than as a control — which
 * is what "not undoable" has to look like on the screen the member actually
 * uses, as well as in the database.
 */
export function ChapterDecision({ chapter, decision, busy, error, onDecide }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (decision) {
    const approved = decision.decision === "approved";

    return (
      <div
        className={[
          "constitution-decision",
          "is-recorded",
          approved ? "is-approved" : "is-rejected",
        ].join(" ")}
      >
        <div className="constitution-decision-head">
          <span className="constitution-decision-badge">
            {approved ? "✓ You approved this chapter" : "✕ You rejected this chapter"}
          </span>

          <span className="constitution-decision-date">
            {shortDate(decision.decidedAt)}
          </span>
        </div>

        {decision.reason && (
          <p className="constitution-decision-reason">“{decision.reason}”</p>
        )}

        <p className="constitution-decision-lock">
          Recorded once, and it cannot be changed — the office sees it on your
          member record.
        </p>
      </div>
    );
  }

  return (
    <div className="constitution-decision">
      <p className="constitution-decision-ask">
        Chapter {chapter.number} — your decision
      </p>

      {!reasonOpen ? (
        <div className="constitution-decision-actions">
          <button
            type="button"
            className="constitution-decision-approve"
            disabled={busy}
            onClick={() => onDecide("approved")}
          >
            {busy ? "Recording…" : "Approve"}
          </button>

          <button
            type="button"
            className="constitution-decision-reject"
            disabled={busy}
            onClick={() => setReasonOpen(true)}
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="constitution-decision-reason-box">
          <label
            htmlFor={`chapter-${chapter.number}-reason`}
            className="constitution-decision-ask"
          >
            Why are you rejecting this chapter?
          </label>

          <textarea
            id={`chapter-${chapter.number}-reason`}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Say briefly what should change"
          />

          <div className="constitution-decision-actions">
            <button
              type="button"
              className="constitution-decision-reject"
              disabled={busy || !reason.trim()}
              onClick={() => onDecide("rejected", reason.trim())}
            >
              {busy ? "Recording…" : "Confirm rejection"}
            </button>

            <button
              type="button"
              className="constitution-decision-cancel"
              disabled={busy}
              onClick={() => setReasonOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="constitution-decision-error" role="alert">
          {error}
        </p>
      )}

      <p className="constitution-decision-lock">
        A decision is recorded once and cannot be undone.
      </p>
    </div>
  );
}
