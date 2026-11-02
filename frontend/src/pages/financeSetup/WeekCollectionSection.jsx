import { METHOD_LABELS } from '../../utils/format';
import { Field } from './shared';

export default function WeekCollectionSection({ collect, collecting, preview, runCollect, setCollect, setConfirming, setPreview }) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <h2 className="text-sm font-bold">A whole week collected for everybody (one-time)</h2>
      <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
        For a week paid in cash before the books opened — week 91 is the one: every member paid
        that week&rsquo;s contribution and that week&rsquo;s tea. It posts both rows for every
        active member at once, dated on the Thursday the week closed, so the money shows against
        week 91 rather than against the opening week. Preview first: nothing is written until you
        post it, and it can be taken back out.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id="collectWeek"
          label="Week number"
          value={collect.weekNumber}
          onChange={(v) => {
            setPreview(null);
            setCollect({ ...collect, weekNumber: v });
          }}
        />
        <Field
          id="collectWeekly"
          label="Contribution each"
          value={collect.weeklyAmount}
          onChange={(v) => {
            setPreview(null);
            setCollect({ ...collect, weeklyAmount: v });
          }}
          money
        />
        <Field
          id="collectChai"
          label="Tea each"
          value={collect.chaiAmount}
          onChange={(v) => {
            setPreview(null);
            setCollect({ ...collect, chaiAmount: v });
          }}
          money
        />
        <div>
          <label htmlFor="collectMethod" className="mb-1 block text-xs font-medium">
            How it came in
          </label>
          <select
            id="collectMethod"
            value={collect.method}
            onChange={(e) => {
              setPreview(null);
              setCollect({ ...collect, method: e.target.value });
            }}
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          >
            {Object.entries(METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => runCollect(true)}
          disabled={collecting}
          className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium disabled:opacity-60"
        >
          {collecting ? 'Checking…' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming('post')}
          disabled={collecting || !preview || preview.posted === 0}
          className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          Post it for everyone
        </button>
        <button
          type="button"
          onClick={() => setConfirming('undo')}
          disabled={collecting}
          className="min-h-11 rounded-lg px-4 text-sm font-medium text-alert disabled:opacity-60"
        >
          Undo this week&rsquo;s batch
        </button>
      </div>

      {preview && (
        <p className="mt-3 rounded-xl border border-rule bg-canvas px-4 py-3 text-xs leading-5">
          {preview.message}
          {preview.posted > 6 && preview.membersAffected?.length > 0 && (
            <span className="mt-1 block text-muted">
              {preview.membersAffected.length} members, from {preview.membersAffected[0]}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
