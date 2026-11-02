import { todayISO } from '../../../utils/format';

export default function AdmissionFields({ admissionComplete, admissionOpen, form, setApproval, setCommitment, setForm }) {
  return (
    <details className="rounded-xl border border-rule p-3" defaultOpen={admissionOpen}>
      <summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-widest text-muted">
        Declaration &amp; approvals <span className="font-normal normal-case tracking-normal">
          {admissionComplete ? '(complete)' : '(pending)'}
        </span>
      </summary>

      <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2 rounded-xl border border-rule px-3 py-3 text-sm">
          <input
            type="checkbox"
            checked={form.commitment.agreed}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                commitment: {
                  ...prev.commitment,
                  agreed: e.target.checked,
                  // Stamped the first time it is ticked, so the date it happened
                  // survives later edits that never touch the box.
                  agreedAt: prev.commitment.agreedAt || todayISO(),
                },
              }))
            }
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Member has read the constitution and accepts the weekly commitment
            <span className="block text-xs text-muted">
              The group's constitution and by-laws, and the weekly contribution agreed by members.
            </span>
          </span>
        </label>

        {form.commitment.agreed && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="m-signed-by" className="mb-1 block text-sm font-medium">
                Signed by
              </label>
              <input
                id="m-signed-by"
                type="text"
                placeholder="Name as signed"
                value={form.commitment.signedBy}
                onChange={setCommitment('signedBy')}
                className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
              />
            </div>

            <div>
              <label htmlFor="m-signed-date" className="mb-1 block text-sm font-medium">
                Date signed
              </label>
              <input
                id="m-signed-date"
                type="date"
                max={todayISO()}
                value={form.commitment.agreedAt}
                onChange={setCommitment('agreedAt')}
                className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium">
            For official use — membership approved by
          </legend>
          <p className="mt-1 text-xs text-muted">
            Type the names the three office bearers signed with. A name left without a
            date is recorded as today.
          </p>

          <ul className="mt-2 space-y-3">
            {form.approvals.map((approval, index) => (
              <li key={approval.role} className="rounded-xl border border-rule bg-page p-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  {approval.label}
                </p>

                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`m-approval-name-${approval.role}`} className="sr-only">
                      {approval.label} name
                    </label>
                    <input
                      id={`m-approval-name-${approval.role}`}
                      type="text"
                      placeholder="Name"
                      value={approval.name}
                      onChange={setApproval(index, 'name')}
                      className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor={`m-approval-date-${approval.role}`} className="sr-only">
                      {approval.label} date signed
                    </label>
                    <input
                      id={`m-approval-date-${approval.role}`}
                      type="date"
                      max={todayISO()}
                      value={approval.signedAt}
                      onChange={setApproval(index, 'signedAt')}
                      className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </details>
  );
}
