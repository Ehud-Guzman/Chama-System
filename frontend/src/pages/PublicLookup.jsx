import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { normalizePhone } from '../utils/phone';
import { CHAMA_NAME } from '../utils/branding';

import GroupOverview from '../components/public/GroupOverview';
import PassbookCard from '../components/public/PassbookCard';
import PublicRecords from '../components/public/PublicRecords';

export default function PublicLookup() {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [lookedUpPhone, setLookedUpPhone] = useState('');
  const [error, setError] = useState('');
  const [chamaName, setChamaName] = useState('');

  const onChamaName = useCallback((name) => {
    setChamaName(name);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();

    const normalized = normalizePhone(phone);

    if (!normalized) {
      setStatus('error');
      setError('Enter a valid phone number, e.g. 0712 345 678');
      return;
    }

    setStatus('loading');
    setError('');
    setResult(null);

    try {
      const res = await api.get('/api/public/lookup', {
        params: {
          phone: normalized,
        },
      });

      setResult(res.data);
      setLookedUpPhone(normalized);
      setStatus('found');
    } catch (err) {
      if (err.response?.status === 404) {
        setStatus('notFound');
      } else {
        setStatus('error');
        setError(
          apiMessage(
            err,
            'Could not check right now. Please try again.'
          )
        );
      }
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-page px-3 py-5 sm:px-5 sm:py-8 lg:px-8 lg:py-10">

      <div className="mx-auto w-full max-w-6xl xl:max-w-7xl">

        {/* =====================================================
            TOP NAV / BRAND
        ====================================================== */}
        <header className="flex items-center justify-between gap-3">

          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-muted sm:text-xs">
              {chamaName || CHAMA_NAME}
            </p>
          </div>

          <nav
            aria-label="Public navigation"
            className="flex shrink-0 items-center gap-1.5 sm:gap-2"
          >
            <Link
              to="/admin/login"
              className="
                inline-flex min-h-9 items-center justify-center
                rounded-lg border border-rule bg-surface
                px-2.5
                text-xs font-semibold text-muted
                transition
                hover:text-primary
                focus:outline-none focus:ring-2
                focus:ring-primary/30
                sm:px-3
              "
            >
              Admin
            </Link>
          </nav>

        </header>

        {/* One column of cards, all the same width: the hero with the lookup in it,
            then the members' area, then the group's totals. Every card shares the
            page's left and right edges — which is what the top of the page was
            missing while the heading and the lookup were two separate blocks. */}
        <main className="mt-8 space-y-5 sm:mt-10">

          {/* =================================================
              HERO AND THE LOOKUP — one card

              The heading and the phone form are the two halves of the one thing
              this page asks for, so they share a surface. As two separate blocks
              they sat at opposite ends of a 1088px row with a dead gap between
              them, which is what made the top of the page read as unrelated pieces.
          ================================================== */}

          <section className="rounded-2xl border border-rule bg-surface p-5 shadow-sm sm:p-7 lg:p-8">

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center lg:gap-10">

            <div>

            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Member portal
            </p>

            <h1 className="mt-2 text-[clamp(2rem,8vw,3rem)] font-bold leading-[1.05] tracking-tight">
              Check your contributions
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-base">
              Group totals are open to everyone. Your own contribution record — and the
              group&rsquo;s documents, minutes and constitution — open with the phone number
              you registered.
            </p>

            </div>

            <form
              onSubmit={onSubmit}
              className="lg:rounded-xl lg:border lg:border-rule lg:bg-page lg:p-5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-3"
              noValidate
            >
              <h2 className="text-base font-bold sm:text-lg lg:col-span-2">
                Find your record
              </h2>

              <p className="mt-1 text-xs leading-5 text-muted sm:text-sm lg:col-span-2">
                Enter the phone number registered with the chama.
              </p>

              <label
                htmlFor="phone"
                className="mt-5 mb-2 block text-sm font-semibold lg:col-span-2"
              >
                Phone number
              </label>

              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="search"
                placeholder="0712 345 678"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);

                  if (status === 'error' || status === 'notFound') {
                    setStatus('idle');
                    setError('');
                  }
                }}
                aria-invalid={status === 'error'}
                aria-describedby={
                  status === 'error' ? 'phone-error' : undefined
                }
                className="
                  amount h-14 w-full rounded-xl
                  border border-rule bg-page
                  px-4 text-base
                  outline-none
                  transition
                  focus:border-primary
                  focus:ring-4 focus:ring-primary/10
                  sm:text-lg
                "
              />

              <button
                type="submit"
                disabled={status === 'loading'}
                className="
                  mt-3 flex h-14 w-full items-center
                  justify-center rounded-xl
                  bg-primary px-5
                  text-sm font-bold text-white
                  shadow-sm
                  transition
                  hover:opacity-95
                  active:scale-[0.99]
                  disabled:cursor-not-allowed
                  disabled:opacity-60
                  lg:mt-0 lg:w-auto lg:px-4
                "
              >
                {status === 'loading' ? (
                  <>
                    <span
                      className="
                        mr-2 h-4 w-4 animate-spin rounded-full
                        border-2 border-white/40
                        border-t-white
                      "
                      aria-hidden="true"
                    />
                    Checking…
                  </>
                ) : (
                  'Check contributions'
                )}
              </button>

              {status === 'error' && (
                <p
                  id="phone-error"
                  className="mt-3 text-sm font-medium text-alert lg:col-span-2"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </form>

            {/* =================================================
                NOT FOUND
            ================================================== */}

            {status === 'notFound' && (
              <div
                className="
                  rounded-xl border border-rule
                  bg-page px-4 py-6 text-center
                  lg:col-span-2
                "
                role="status"
              >
                <div
                  className="
                    mx-auto flex h-10 w-10 items-center
                    justify-center rounded-full
                    bg-muted/10 text-lg
                  "
                  aria-hidden="true"
                >
                  ?
                </div>

                <p className="mt-3 font-bold">
                  No record found
                </p>

                <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-muted">
                  No member record was found for that number.
                  If your number is registered with the group,
                  please contact the treasurer.
                </p>
              </div>
            )}

            </div>

          </section>

          {/* =================================================
              MEMBER RESULT

              Full width: the passbook carries a stat grid and a ledger that
              were being squeezed into the same 576px column as the hero.
          ================================================== */}

          {status === 'found' && result && (
            <section aria-label="Your contribution record">
              <PassbookCard
                key={result.regNumber || result.name}
                result={result}
                statementUrl={`/api/public/lookup/statement?phone=${lookedUpPhone}`}
                statementExcelUrl={`/api/public/lookup/statement/excel?phone=${lookedUpPhone}`}
              />
            </section>
          )}

          {/* =================================================
              CHAMA DOCUMENTS, MINUTES & CONSTITUTION

              Locked until a registered phone number is given.
              A successful lookup above already proved one, so the
              members' area opens itself rather than asking again.
          ================================================== */}

          <section aria-label="Chama documents, minutes and constitution">
            <PublicRecords
              key={lookedUpPhone || 'locked'}
              verifiedPhone={lookedUpPhone}
            />
          </section>

        {/* =====================================================
            GROUP OVERVIEW
        ====================================================== */}

          <section aria-label="Group overview">
            <GroupOverview onChamaName={onChamaName} />
          </section>
        </main>

        {/* =====================================================
            FOOTER
        ====================================================== */}

        <footer className="mt-12 border-t border-rule py-6 text-center text-xs text-muted">
          <p>
            Your own record, opened with the number you registered — nothing here lists
            the members.
          </p>

          <div className="mt-2 flex items-center justify-center gap-3">
            <Link
              to="/admin/login"
              className="underline-offset-2 hover:underline"
            >
              Admin
            </Link>
          </div>
        </footer>

      </div>
    </div>
  );
}
