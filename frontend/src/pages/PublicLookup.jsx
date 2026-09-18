import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { normalizeNationalId, NATIONAL_ID_ERROR } from '../utils/nationalId';
import { CHAMA_NAME, CHAMA_LOGO } from '../utils/branding';
import { LOGO_PX, sizedImage } from '../utils/imageUrl';

import GroupOverview from '../components/public/GroupOverview';
import PassbookCard from '../components/public/PassbookCard';
import PublicRecords from '../components/public/PublicRecords';
import VisionMission from '../components/public/VisionMission';
import CreditLine from '../components/shared/CreditLine';

export default function PublicLookup() {
  // The ID entered at the gate — the number the office recorded for this member.
  const [id, setId] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  // The ID that was accepted, normalised: it keys the passbook, the statement
  // downloads and the members' area below.
  const [lookedUpId, setLookedUpId] = useState('');
  const [error, setError] = useState('');

  // Everything the page knows about the group itself: its name, its logo, its
  // totals and its two statements. One request, because the overview is the
  // heaviest aggregate the public API computes and the brand row, the totals and
  // the vision/mission card each need a piece of the same response.
  const [overview, setOverview] = useState(null);

  // The header mark is drawn at 36–40px. The office uploads a 512px one, and the
  // CDN can serve it at the size it is actually used — a URL rewrite, no re-upload.
  // `limit` never enlarges, so a small wordmark still looks like itself.
  const optimizedLogo = sizedImage(overview?.logoUrl, {
    w: LOGO_PX.header,
    h: LOGO_PX.header,
    fit: 'limit',
  });

  useEffect(() => {
    api
      .get('/api/public/overview')
      .then((res) => setOverview(res.data))
      .catch(() => {
        // Non-fatal — the page still works for personal lookup without it
      });
  }, []);

  async function onSubmit(e) {
    e.preventDefault();

    const normalized = normalizeNationalId(id);

    if (!normalized) {
      setStatus('error');
      setError(NATIONAL_ID_ERROR);
      return;
    }

    setStatus('loading');
    setError('');
    setResult(null);

    try {
      const res = await api.get('/api/public/lookup', {
        params: {
          nationalId: normalized,
        },
      });

      setResult(res.data);
      setLookedUpId(normalized);
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

          {/* The group's own logo once one has been uploaded (Settings → logo);
              until then the mark the app ships. Both draw at the same size, so the
              row does not jump the moment the real one replaces the placeholder.
              alt is empty on purpose: the group's name is printed right beside it,
              and a screen reader would otherwise say both. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src={optimizedLogo || CHAMA_LOGO}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg object-contain sm:h-10 sm:w-10"
            />

            <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-muted sm:text-xs">
              {overview?.chamaName || CHAMA_NAME}
            </p>
          </div>

          <nav
            aria-label="Public navigation"
            className="flex shrink-0 items-center gap-1.5 sm:gap-2"
          >
            <Link
              to="/admin/login"
              className="
                inline-flex min-h-11 items-center justify-center
                rounded-lg border border-rule bg-surface
                px-3
                text-sm font-semibold text-muted
                transition
                hover:text-primary
                focus:outline-none focus:ring-2
                focus:ring-primary/30
                sm:px-4
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

              The heading and the ID form are the two halves of the one thing
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
              group&rsquo;s documents, minutes and constitution — open with the ID number
              registered with the chama.
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
                Enter the ID number registered with the chama.
              </p>

              <label
                htmlFor="member-id"
                className="mt-5 mb-2 block text-sm font-semibold lg:col-span-2"
              >
                ID number
              </label>

              <input
                id="member-id"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="12345678"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);

                  if (status === 'error' || status === 'notFound') {
                    setStatus('idle');
                    setError('');
                  }
                }}
                aria-invalid={status === 'error'}
                aria-describedby={
                  status === 'error' ? 'member-id-error' : undefined
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
                  id="member-id-error"
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
                  No member record was found for that ID number.
                  If the office has not recorded your ID yet,
                  please ask the treasurer.
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
                statementUrl={`/api/public/lookup/statement?nationalId=${lookedUpId}`}
                statementExcelUrl={`/api/public/lookup/statement/excel?nationalId=${lookedUpId}`}
              />
            </section>
          )}

          {/* =================================================
              CHAMA DOCUMENTS, MINUTES & CONSTITUTION

              Locked until the ID recorded for a member is given.
              A successful lookup above already proved one, so the
              members' area opens itself rather than asking again.
          ================================================== */}

          <section aria-label="Chama documents, minutes and constitution">
            <PublicRecords
              key={lookedUpId || 'locked'}
              verifiedId={lookedUpId}
            />
          </section>

        {/* =====================================================
            GROUP OVERVIEW AND THE GROUP'S OWN STATEMENTS
        ====================================================== */}

          <section aria-label="Group overview">
            <GroupOverview overview={overview} />
          </section>

          {/* The constitution's own vision and mission (Chapter 2), unless the
              office has rewritten either in Settings. Last card before the footer:
              a returning member came for his record, not for a statement. */}
          <VisionMission vision={overview?.vision} mission={overview?.mission} />
        </main>

        {/* =====================================================
            FOOTER
        ====================================================== */}

        <footer className="mt-12 border-t border-rule py-6 text-center text-xs text-muted">
          <p>
            Your own record, opened with the ID number registered with the group — nothing
            here lists the members.
          </p>

          <div className="mt-2 flex items-center justify-center gap-3">
            <Link
              to="/admin/login"
              className="underline-offset-2 hover:underline"
            >
              Admin
            </Link>
          </div>

          {/* The credit, at the very bottom where one belongs. The link opens in a
              new tab so a member never loses the page — and the ID he just typed —
              by tapping it. */}
          <CreditLine className="mt-4" />
        </footer>

      </div>
    </div>
  );
}
