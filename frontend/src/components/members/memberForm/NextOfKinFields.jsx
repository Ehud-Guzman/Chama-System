import { KIN_QUICK_ADD, KIN_RELATIONSHIPS } from './shared';

export default function NextOfKinFields({ addKin, adminOnlyHint, form, kinLocked, removeKin, setKin }) {
  return (
    <fieldset className="rounded-xl border border-rule p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
        Next of kin
      </legend>

      <p className="text-xs text-muted">
        Add as many as you need — spouse, children, in-laws. Each one needs a name
        and a phone number or an email.
        {kinLocked && ` ${adminOnlyHint}`}
      </p>

      <ul className="mt-2 space-y-3">
        {form.nextOfKin.map((kin, index) => (
          <li
            key={index}
            className="rounded-xl border border-rule bg-page p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Contact {index + 1}
                {kin.relationship ? ` · ${kin.relationship}` : ''}
              </p>

              <button
                type="button"
                onClick={() => removeKin(index)}
                disabled={kinLocked}
                className="min-h-11 rounded-lg px-2 text-sm font-medium text-alert disabled:text-muted"
              >
                Remove
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor={`kin-name-${index}`} className="sr-only">
                  Contact {index + 1} name
                </label>
                <input
                  id={`kin-name-${index}`}
                  type="text"
                  placeholder="Name"
                  value={kin.name}
                  onChange={setKin(index, 'name')}
                  disabled={kinLocked}
                  className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm disabled:bg-elevation disabled:text-muted"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor={`kin-relationship-${index}`} className="sr-only">
                  Contact {index + 1} relationship
                </label>
                <input
                  id={`kin-relationship-${index}`}
                  type="text"
                  list="kin-relationship-options"
                  placeholder="Relationship — spouse, daughter, in-law…"
                  value={kin.relationship}
                  onChange={setKin(index, 'relationship')}
                  disabled={kinLocked}
                  className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm disabled:bg-elevation disabled:text-muted"
                />
              </div>

              <div>
                <label htmlFor={`kin-phone-${index}`} className="sr-only">
                  Contact {index + 1} phone
                </label>
                <input
                  id={`kin-phone-${index}`}
                  type="tel"
                  inputMode="tel"
                  placeholder="07XX XXX XXX"
                  value={kin.phone}
                  onChange={setKin(index, 'phone')}
                  disabled={kinLocked}
                  className="amount h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm disabled:bg-elevation disabled:text-muted"
                />
              </div>

              <div>
                <label htmlFor={`kin-email-${index}`} className="sr-only">
                  Contact {index + 1} email
                </label>
                <input
                  id={`kin-email-${index}`}
                  type="email"
                  placeholder="Email (optional)"
                  value={kin.email}
                  onChange={setKin(index, 'email')}
                  disabled={kinLocked}
                  className="amount h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm disabled:bg-elevation disabled:text-muted"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <datalist id="kin-relationship-options">
        {KIN_RELATIONSHIPS.map((relationship) => (
          <option key={relationship} value={relationship} />
        ))}
      </datalist>

      <div className="mt-3 flex flex-wrap gap-2">
        {KIN_QUICK_ADD.map((relationship) => (
          <button
            key={relationship}
            type="button"
            onClick={() => addKin(relationship)}
            disabled={kinLocked}
            className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium text-primary disabled:opacity-50"
          >
            + {relationship}
          </button>
        ))}

        <button
          type="button"
          onClick={() => addKin()}
          disabled={kinLocked}
          className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium disabled:opacity-50"
        >
          + Another contact
        </button>
      </div>
    </fieldset>
  );
}
