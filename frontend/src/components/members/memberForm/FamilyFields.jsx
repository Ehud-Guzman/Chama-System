export default function FamilyFields({ addChild, familyOnFile, familyOpen, form, removeChild, setChild, setFamily }) {
  return (
    <details className="rounded-xl border border-rule p-3" defaultOpen={familyOpen}>
      <summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-widest text-muted">
        Family <span className="font-normal normal-case tracking-normal">
          {familyOnFile ? '(on file)' : '(optional)'}
        </span>
      </summary>

      <p className="mt-2 text-xs text-muted">
        Spouse, children, parents and in-laws — the family the group supports
        and calls on.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="m-spouse" className="mb-1 block text-sm font-medium">
            Spouse's name
          </label>
          <input
            id="m-spouse"
            type="text"
            value={form.family.spouseName}
            onChange={setFamily('spouseName')}
            className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Children</legend>
          <ul className="space-y-2">
            {form.family.children.map((child, index) => (
              <li key={index} className="flex items-center gap-2">
                <label htmlFor={`m-child-${index}`} className="sr-only">
                  Child {index + 1}
                </label>
                <input
                  id={`m-child-${index}`}
                  type="text"
                  placeholder={`Child ${index + 1}`}
                  value={child}
                  onChange={setChild(index)}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-rule px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeChild(index)}
                  className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-alert"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addChild}
            className="mt-2 min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium text-primary"
          >
            + Another child
          </button>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="m-father" className="mb-1 block text-sm font-medium">
              Father's name
            </label>
            <input
              id="m-father"
              type="text"
              value={form.family.fatherName}
              onChange={setFamily('fatherName')}
              className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
            />
          </div>

          <div>
            <label htmlFor="m-mother" className="mb-1 block text-sm font-medium">
              Mother's name
            </label>
            <input
              id="m-mother"
              type="text"
              value={form.family.motherName}
              onChange={setFamily('motherName')}
              className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
            />
          </div>

          <div>
            <label htmlFor="m-father-in-law" className="mb-1 block text-sm font-medium">
              Father-in-law's name
            </label>
            <input
              id="m-father-in-law"
              type="text"
              value={form.family.fatherInLawName}
              onChange={setFamily('fatherInLawName')}
              className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
            />
          </div>

          <div>
            <label htmlFor="m-mother-in-law" className="mb-1 block text-sm font-medium">
              Mother-in-law's name
            </label>
            <input
              id="m-mother-in-law"
              type="text"
              value={form.family.motherInLawName}
              onChange={setFamily('motherInLawName')}
              className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
            />
          </div>
        </div>
      </div>
    </details>
  );
}
