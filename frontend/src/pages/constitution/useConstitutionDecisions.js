// The member's decisions: approve or reject each chapter, once, and what has been decided so far.
// Cut out of pages/PublicConstitution.jsx so the page file only has to arrange the screen.

import { useCallback, useMemo, useState } from "react";
import api, { apiMessage } from "../../services/api";
import { passHeaders, sessionEnded } from "../../services/memberPass";

export default function useConstitutionDecisions({ pass, summary, setSummary }) {
  const [savingChapter, setSavingChapter] = useState(null);
  const [decisionError, setDecisionError] = useState({ chapterNumber: null, message: "" });

  /*
   * ---------------------------------------------------------
   * THE MEMBER'S DECISIONS
   * ---------------------------------------------------------
   * Approve or reject, once per chapter. The server is the authority — it refuses
   * a second decision — and it answers with the whole updated record, so this page
   * never has to guess what was saved.
   */
  const decisionsByChapter = useMemo(() => {
    const map = new Map();

    (summary?.decisions || []).forEach((decision) => {
      map.set(decision.chapterNumber, decision);
    });

    return map;
  }, [summary]);

  const reviewedChapters = summary?.decided || 0;
  const totalChapters = summary?.total || 0;
  const approvedPercent = totalChapters ? (summary.approved / totalChapters) * 100 : 0;
  const rejectedPercent = totalChapters ? (summary.rejected / totalChapters) * 100 : 0;

  const recordDecision = useCallback(
    async (chapterNumber, decision, reason = "") => {
      setSavingChapter(chapterNumber);
      setDecisionError({ chapterNumber: null, message: "" });

      try {
        const res = await api.post(
          "/api/public/constitution/decision",
          { chapterNumber, decision, reason },
          { headers: passHeaders(pass) },
        );

        setSummary(res.data?.summary || null);
      } catch (err) {
        setDecisionError({
          chapterNumber,
          message: sessionEnded(err)
            ? "Your session has ended. Go back and enter your ID number again — nothing you have already recorded is lost."
            : apiMessage(err, "Could not record your decision right now. Please try again."),
        });
      } finally {
        setSavingChapter(null);
      }
    },
    [pass, setSummary],
  );

  return {
    savingChapter,
    decisionError,
    decisionsByChapter,
    reviewedChapters,
    totalChapters,
    approvedPercent,
    rejectedPercent,
    recordDecision,
  };
}
