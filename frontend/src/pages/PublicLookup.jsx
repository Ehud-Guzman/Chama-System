import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';

import GroupOverview from '../components/public/GroupOverview';
import PassbookCard from '../components/public/PassbookCard';
import DirectoryList from '../components/public/DirectoryList';
import ResignedMembersList from '../components/public/ResignedMembersList';

// Mirrors the backend normalizer for instant client-side validation
function normalizePhone(input) {
  let digits = String(input).replace(/[\s\-().]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  if (digits.length === 12 && digits.startsWith('254')) {
    digits = '0' + digits.slice(3);
  } else if (digits.length === 9 && /^[17]/.test(digits)) {
    digits = '0' + digits;
  }

  return /^0[17]\d{8}$/.test(digits) ? digits : null;
}

export default function PublicLookup() {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [lookedUpPhone, setLookedUpPhone] = useState('');
  const [error, setError] = useState('');
  const [chamaName, setChamaName] = useState('');
  const [directoryTab, setDirectoryTab] = useState('current');

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

      <main className="mx-auto w-full max-w-6xl">

        {/* =====================================================
            TOP NAV / BRAND
        ====================================================== */}
        <header className="mx-auto w-full max-w-xl">

          <div className="flex items-center justify-between gap-3">

            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-muted sm:text-xs">
                {chamaName || 'Contribution Manager'}
              </p>
            </div>

            <nav
              aria-label="Public navigation"
              className="flex shrink-0 items-center gap-1.5 sm:gap-2"
            >
              <Link
                to="/constitution"
                className="
                  inline-flex min-h-9 items-center justify-center
                  rounded-lg px-2.5
                  text-xs font-semibold text-muted
                  transition
                  hover:bg-surface hover:text-primary
                  focus:outline-none focus:ring-2
                  focus:ring-primary/30
                  sm:px-3
                "
              >
                Constitution
              </Link>

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

          </div>

          {/* =================================================
              HERO
          ================================================== */}

          <section className="mt-8 sm:mt-10">

            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Member portal
            </p>

            <h1 className="mt-2 text-[clamp(2rem,8vw,3rem)] font-bold leading-[1.05] tracking-tight">
              Check your contributions
            </h1>

            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base">
              See what the group has raised and securely find your own
              contribution record using your registered phone number.
            </p>

          </section>

          {/* =================================================
              LOOKUP CARD
          ================================================== */}

          <section
            className="
              mt-6 rounded-2xl border border-rule
              bg-surface p-4 shadow-sm
              sm:mt-7 sm:p-6
            "
          >

            <div>
              <h2 className="text-base font-bold sm:text-lg">
                Find your record
              </h2>

              <p className="mt-1 text-xs leading-5 text-muted sm:text-sm">
                Enter the phone number registered with the chama.
              </p>
            </div>

            <form
              onSubmit={onSubmit}
              className="mt-5"
              noValidate
            >
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-semibold"
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
                  className="mt-3 text-sm font-medium text-alert"
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
                  mt-5 rounded-xl border border-rule
                  bg-page px-4 py-6 text-center
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

          </section>

          {/* =================================================
              MEMBER RESULT
          ================================================== */}

          {status === 'found' && result && (
            <section
              className="mt-5"
              aria-label="Your contribution record"
            >
              <PassbookCard
                key={result.regNumber || result.name}
                result={result}
                statementUrl={`/api/public/lookup/statement?phone=${lookedUpPhone}`}
              />
            </section>
          )}

        </header>

        {/* =====================================================
            GROUP OVERVIEW
        ====================================================== */}

        <section
          className="mt-8 sm:mt-10"
          aria-label="Group overview"
        >
          <GroupOverview onChamaName={onChamaName} />
        </section>

        {/* =====================================================
            MEMBER DIRECTORY
        ====================================================== */}

        <section
          className="mt-8 sm:mt-12"
          aria-labelledby="directory-heading"
        >

          {/* Directory heading */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">

            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
                Member directory
              </p>

              <h2
                id="directory-heading"
                className="mt-1 text-xl font-bold sm:text-2xl"
              >
                {directoryTab === 'current'
                  ? 'All members'
                  : 'Resigned members'}
              </h2>

              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">
                {directoryTab === 'current'
                  ? 'Browse the full membership — open to everyone, no login required.'
                  : 'Members who have explicitly resigned from the group.'}
              </p>
            </div>

            {/* =================================================
                TABS
            ================================================== */}

            <div
              className="
                grid w-full grid-cols-2
                rounded-xl border border-rule
                bg-surface p-1
                sm:w-auto sm:min-w-[210px]
              "
              role="tablist"
              aria-label="Member directory"
            >
              <button
                type="button"
                role="tab"
                aria-selected={directoryTab === 'current'}
                aria-pressed={directoryTab === 'current'}
                onClick={() => setDirectoryTab('current')}
                className={`
                  min-h-11 rounded-lg px-3
                  text-xs font-bold
                  transition
                  ${
                    directoryTab === 'current'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-muted hover:text-primary'
                  }
                `}
              >
                Current
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={directoryTab === 'resigned'}
                aria-pressed={directoryTab === 'resigned'}
                onClick={() => setDirectoryTab('resigned')}
                className={`
                  min-h-11 rounded-lg px-3
                  text-xs font-bold
                  transition
                  ${
                    directoryTab === 'resigned'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-muted hover:text-primary'
                  }
                `}
              >
                Resigned
              </button>
            </div>

          </div>

          {/* Directory */}
          <div className="mt-4 min-w-0 overflow-hidden sm:mt-5">
            {directoryTab === 'current' ? (
              <DirectoryList />
            ) : (
              <ResignedMembersList />
            )}
          </div>

        </section>

        {/* =====================================================
            FOOTER
        ====================================================== */}

        <footer className="mt-12 border-t border-rule py-6 text-center text-xs text-muted">
          <p>
            Public contribution records
          </p>

          <div className="mt-2 flex items-center justify-center gap-3">
            <Link
              to="/constitution"
              className="underline-offset-2 hover:underline"
            >
              Constitution
            </Link>

            <span aria-hidden="true">•</span>

            <Link
              to="/admin/login"
              className="underline-offset-2 hover:underline"
            >
              Admin
            </Link>
          </div>
        </footer>

      </main>
    </div>
  );
}