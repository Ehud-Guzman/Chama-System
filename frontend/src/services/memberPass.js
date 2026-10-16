// The pass a member holds once he has proved who he is (backend utils/memberToken).
//
// The ID number is spent once - at the lookup or at the records gate - and what comes back is a
// signed, one-hour pass for that member alone. It travels in this header, never in a URL, and it
// is held in component state only: not in storage, so closing the tab ends it.
export const PASS_HEADER = 'X-Member-Token';

export function passHeaders(pass) {
  return pass ? { [PASS_HEADER]: pass } : {};
}

// The API answers 401 with `sessionEnded` when a pass has expired, been tampered with, or belongs to
// a member who has since left - or is the wrong kind for the passbook. The screen's answer to all of
// them is the same: ask for the number again.
export function sessionEnded(err) {
  return err?.response?.status === 401 && Boolean(err.response?.data?.sessionEnded);
}
