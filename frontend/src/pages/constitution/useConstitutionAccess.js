// The constitution's way in: trading the ID (or a pass brought from the members' area) for the document.
// Cut out of pages/PublicConstitution.jsx so the page file only has to arrange the screen.

import { useCallback, useEffect, useState } from "react";
import api, { apiMessage } from "../../services/api";
import { normalizeNationalId, NATIONAL_ID_ERROR } from "../../utils/nationalId";
import { passHeaders } from "../../services/memberPass";

export default function useConstitutionAccess(linkedPass) {
  /*
   * ---------------------------------------------------------
   * ID GATE — the constitution is a members' document
   * ---------------------------------------------------------
   * It is fetched from the server only for an ID registered with the
   * chama, and it is deliberately not shipped in the app bundle, so there is
   * nothing to read here before proving a number — see
   * GET /api/public/constitution.
   */
  const [id, setId] = useState("");
  const [status, setStatus] = useState(linkedPass ? "loading" : "locked");
  const [gateError, setGateError] = useState("");
  const [doc, setDoc] = useState(null);
  // The pass that opened the document, so a decision can be posted without asking for the number
  // again. The number itself is never kept.
  const [pass, setPass] = useState("");
  // What this member has already decided, chapter by chapter, as the server
  // reports it — the same record the office sees on his profile.
  const [summary, setSummary] = useState(null);

  const openWithPass = useCallback(async (token) => {
    setStatus("loading");
    setGateError("");

    try {
      const res = await api.get("/api/public/constitution", { headers: passHeaders(token) });
      setDoc(res.data);
      setSummary(res.data?.summary || null);
      setPass(token);
      setStatus("unlocked");
    } catch (err) {
      setDoc(null);
      setSummary(null);
      setPass("");
      setStatus("error");
      setGateError(apiMessage(err, "Could not open the constitution right now. Please try again."));
    }
  }, []);

  // The ID, once: traded here for a pass, and not kept.
  const unlock = useCallback(
    async (rawId) => {
      const normalized = normalizeNationalId(rawId);

      if (!normalized) {
        setStatus("error");
        setGateError(NATIONAL_ID_ERROR);
        return;
      }

      setStatus("loading");
      setGateError("");

      try {
        const res = await api.post("/api/public/records/unlock", { nationalId: normalized });
        await openWithPass(res.data.memberToken);
      } catch (err) {
        setDoc(null);
        setSummary(null);
        setPass("");
        setStatus("error");
        setGateError(
          err.response?.status === 404
            ? "That ID is not recorded against any active member. Check the number, or ask the treasurer to add it."
            : apiMessage(err, "Could not open the constitution right now. Please try again.")
        );
      }
    },
    [openWithPass],
  );

  function onSubmitGate(event) {
    event.preventDefault();
    unlock(id);
  }

  // Arriving from the members' area: the ID was proved there a moment ago, so
  // the page opens straight onto the document instead of asking for it twice.
  useEffect(() => {
    if (linkedPass) openWithPass(linkedPass);
  }, [linkedPass, openWithPass]);

  return { id, setId, status, setStatus, gateError, setGateError, doc, pass, summary, setSummary, onSubmitGate };
}
