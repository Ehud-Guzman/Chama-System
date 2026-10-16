import { useCallback, useEffect, useState } from "react";
import api, { apiMessage } from "../../services/api";
import { shortDateTime } from "../../utils/format";

// The super admin's own corner of the audit screen: how the officers behave, how well their
// accounts are protected, and whether the trail itself is still whole.
//
// Everything here is derived server-side from the trail and the user list. The panel only
// renders it — and the endpoints refuse anyone but the super admin, so hiding it from other
// roles is a courtesy, not the control.
const REASON_LABELS = {
  wrong_password: "wrong password",
  no_such_account: "not an account",
  deactivated: "deactivated account",
  wrong_2fa_code: "wrong code",
};

const ROLE_LABELS = {
  super_admin: "Super admin",
  admin: "Admin",
  treasurer: "Treasurer",
  secretary: "Secretary",
  disciplinary: "Disciplinary",
};

// The trail check is a deliberate button, not something that runs on load: it reads the
// whole trail, and the answer is only worth anything when somebody asked for it.
function VerifyTrail() {
  const [state, setState] = useState({ status: "idle" });

  async function run() {
    setState({ status: "running" });
    try {
      const res = await api.post("/api/audit/verify");
      setState({ status: res.data.ok ? "intact" : "broken", result: res.data });
    } catch (err) {
      setState({ status: "error", message: apiMessage(err, "Could not check the trail") });
    }
  }

  const { status, result } = state;
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">Is the trail intact?</h3>
          <p className="mt-0.5 max-w-xl text-xs leading-5 text-muted">
            Every entry carries the fingerprint of the one before it. Edit, remove or slip in an
            entry anywhere and every fingerprint after it stops matching. This re-checks all of
            them.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={status === "running"}
          className="min-h-11 shrink-0 rounded-lg border border-rule bg-canvas px-4 text-sm font-medium disabled:opacity-60"
        >
          {status === "running" ? "Checking…" : "Verify the trail"}
        </button>
      </div>

      {status === "intact" && (
        <div role="status" className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          <p className="font-semibold">
            Intact — {result.checked} {result.checked === 1 ? "entry" : "entries"} checked.
          </p>
          {result.head && (
            <p className="amount mt-1 break-all text-[11px] leading-4">
              Chain head: {result.head}
            </p>
          )}
          <p className="mt-1 text-[11px] leading-4 text-muted">
            Write the head down somewhere outside this system, with today's date. Next month, a
            trail that has had entries removed from the end will not end here.
            {result.unchecked > 0 &&
              ` ${result.unchecked} older ${result.unchecked === 1 ? "entry" : "entries"} predate the check and cannot be verified.`}
          </p>
        </div>
      )}

      {status === "broken" && (
        <div role="alert" className="mt-3 rounded-lg bg-alert/10 px-3 py-2 text-sm text-alert">
          <p className="font-semibold">The trail has been tampered with.</p>
          <p className="mt-1">{result.message}</p>
          <p className="mt-1 text-[11px] leading-4">
            Nothing after that point can be trusted. Do not edit the database — compare against the
            latest backup and tell the committee first.
          </p>
        </div>
      )}

      {status === "error" && (
        <p role="alert" className="mt-3 text-sm text-alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

function Count({ value, alert }) {
  return (
    <td className={`amount px-2 py-1.5 text-right ${value > 0 && alert ? "font-semibold text-alert" : ""}`}>
      {value}
    </td>
  );
}

export default function AuditOversightPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get("/api/audit/oversight");
      setData(res.data);
    } catch (err) {
      setError(apiMessage(err, "Could not load the oversight read"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const weak = (data?.accounts || []).filter((a) => a.notes.some((n) => n !== "deactivated"));

  return (
    <section aria-labelledby="oversight-heading" className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Super admin only</p>
        <h2 id="oversight-heading" className="text-lg font-bold">
          Oversight
        </h2>
        <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted">
          Admins and treasurers cannot see this. They also cannot read the trail's entries about
          admin, treasurer and super-admin accounts, or about backups, restores and scheduled jobs.
        </p>
      </div>

      <VerifyTrail />

      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}{" "}
          <button type="button" onClick={load} className="font-medium underline">
            Try again
          </button>
        </p>
      )}

      {data && (
        <>
          <div className="overflow-hidden rounded-xl border border-rule bg-surface">
            <div className="border-b border-rule px-4 py-2">
              <h3 className="text-sm font-bold">Officers, last {data.days} days</h3>
              <p className="text-[11px] leading-4 text-muted">
                Most worth asking about first. Counts, not verdicts — the trail underneath has the
                answer.
                {data.limited ? " Only the newest part of a busy month was read." : ""}
              </p>
            </div>
            {data.officers.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">No activity in that time.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                      <th scope="col" className="px-4 py-1.5 font-semibold">Who</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">Entries</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">Serious</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">Amounts cut</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">Money removed</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">Moved</th>
                      <th scope="col" className="px-4 py-1.5 text-right font-semibold">Last active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {data.officers.map((o) => (
                      <tr key={o.id}>
                        <th scope="row" className="px-4 py-1.5 text-left font-medium">
                          {o.name}
                          <span className="ml-1.5 text-[11px] font-normal text-muted">
                            {ROLE_LABELS[o.role] || o.role}
                          </span>
                        </th>
                        <Count value={o.entries} />
                        <Count value={o.serious} alert />
                        <Count value={o.amountCuts} alert />
                        <Count value={o.moneyRemoved} alert />
                        <Count value={o.movedMoney} alert />
                        <td className="amount px-4 py-1.5 text-right text-[11px] text-muted">
                          {o.lastAt ? shortDateTime(o.lastAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-rule bg-surface">
            <div className="border-b border-rule px-4 py-2">
              <h3 className="text-sm font-bold">Accounts that hold authority</h3>
              <p className="text-[11px] leading-4 text-muted">
                {weak.length === 0
                  ? "Nothing weak to report."
                  : `${weak.length} ${weak.length === 1 ? "account needs" : "accounts need"} a look.`}
                {data.twoFactorGroupOn
                  ? ""
                  : " Two-factor is off for the group, so a missing second factor is not counted."}
              </p>
            </div>
            <ul className="divide-y divide-rule">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-1.5">
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-[11px] text-muted">{ROLE_LABELS[a.role] || a.role}</span>
                  {a.notes.map((n) => (
                    <span
                      key={n}
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${
                        n === "deactivated" ? "bg-canvas text-muted" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {n}
                    </span>
                  ))}
                  <span className="ml-auto text-[11px] text-muted">
                    {a.secondFactor ? "second factor on" : "no second factor"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-xl border border-rule bg-surface">
            <div className="border-b border-rule px-4 py-2">
              <h3 className="text-sm font-bold">Failed sign-ins, last {data.days} days</h3>
              <p className="text-[11px] leading-4 text-muted">
                {data.signIns.failed === 0
                  ? "None."
                  : `${data.signIns.failed} in all. An account that exists and is being guessed at is listed first; an address that is not an account is usually a typo.`}
                {" "}You are emailed when one account or one address reaches 5 in 15 minutes.
              </p>
            </div>
            {data.signIns.accounts.length > 0 && (
              <ul className="divide-y divide-rule">
                {data.signIns.accounts.slice(0, 10).map((a) => (
                  <li key={a.email} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-1.5">
                    <span className="min-w-0 break-all text-sm font-medium">{a.email}</span>
                    {a.isAccount && (
                      <span className="text-[11px] text-muted">{ROLE_LABELS[a.role] || "account"}</span>
                    )}
                    {a.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] leading-4 text-muted">
                        {REASON_LABELS[r] || r}
                      </span>
                    ))}
                    <span className="amount ml-auto text-sm font-semibold">
                      {a.count}×
                      <span className="ml-2 text-[11px] font-normal text-muted">
                        {a.lastAt ? shortDateTime(a.lastAt) : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.signIns.addresses.length > 0 && (
              <p className="amount border-t border-rule px-4 py-1.5 text-[11px] text-muted">
                Busiest addresses:{" "}
                {data.signIns.addresses.map((a) => `${a.ip} (${a.count})`).join(" · ")}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
