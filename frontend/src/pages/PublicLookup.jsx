import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { normalizeNationalId, maskNationalId, NATIONAL_ID_ERROR } from '../utils/nationalId';
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
  // The ID field itself, so "check another ID" can put the cursor back in the box that just stood
  // down rather than leaving somebody to hunt for it.
  const idInputRef = useRef(null);

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

  // Bumped by "check another ID". The field is not on the page at the moment that button is
  // pressed — the render that follows is what mounts it — so the focus has to wait for that
  // render, which is what an effect is for. Focusing the node directly in the click handler
  // silently does nothing, because the node is null by then.
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    if (focusTick === 0) return;
    idInputRef.current?.focus();
  }, [focusTick]);

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

  // Back to the form. The accepted ID is cleared along with the result, which locks the members'
  // area again: that gate follows the number it verified, and leaving it open behind a member who
  // has moved on to a different record is the one thing it must not do.
  function resetLookup() {
    setStatus('idle');
    setResult(null);
    setLookedUpId('');
    setError('');
    setId('');
    setFocusTick((n) => n + 1);
  }

  const foundNow = status === 'found' && Boolean(result);

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

        {/* The page, top to bottom: the lookup — or, once it has answered, the one line saying
            which record is open — then the member's own record, then the members' area, and last
            the group's public band. Every block shares the page's left and right edges, which is
            what the top of the page was missing while the heading and the lookup were two separate
            blocks; and the last two are set apart by more than a gap, because the group's figures
            are public and must not read as one more panel of a member's record. */}
        <main className="mt-8 space-y-5 sm:mt-10">

          {foundNow ? (
            /* =================================================
                RECORD OPEN — the lookup has done its job.

                The hero stands down to this one line and the member's own
                record moves to the top of the page. It used to keep its full
                height after the answer arrived — a 3rem headline and a form
                card still filling the first screen — so the page's whole
                reason for existing began below the fold.

                The ID is shown masked to its last three digits. This line's
                job is to say which number is open; a shared phone or a
                screenshot should not spell out the credential the gate
                rides on.
            ================================================== */
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rule bg-surface px-4 py-3 shadow-sm sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
                    Record open
                  </p>
                  <p className="truncate text-sm font-semibold">
                    {result.regNumber ? `Member № ${result.regNumber}` : 'Your record'}
                    <span className="amount ml-2 text-xs font-normal text-muted">
                      ID {maskNationalId(lookedUpId)}
                    </span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={resetLookup}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-rule px-3 text-sm font-semibold text-primary transition hover:bg-elevation sm:px-4"
              >
                Check another ID
              </button>
            </section>
          ) : (
            <>
          {/* =================================================
              THE LOOKUP — while it is still the question.

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

            <h1 className="mt-2 text-[clamp(1.75rem,7vw,2.75rem)] font-bold leading-[1.05] tracking-tight">
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
              aria-label="Find your record"
              className="lg:rounded-xl lg:border lg:border-rule lg:bg-page lg:p-5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-3"
              noValidate
            >
              {/* The form is named for a screen reader rather than by a heading of its own: the
                  hero beside it already says what this page is for, and a second heading saying
                  the same thing only pushed the field further down a phone's first screen. */}

              <p className="text-xs leading-5 text-muted sm:text-sm lg:col-span-2">
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
                ref={idInputRef}
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

            </div>
          </section>

              {/* =================================================
                  NOT FOUND

                  Its own band under the hero, rather than a box inside the
                  hero's grid: on a wide screen it used to land under the
                  left-hand column, a screen away from the field that
                  produced it.
              ================================================== */}

              {status === 'notFound' && (
                <section
                  className="rounded-2xl border border-rule bg-surface px-6 py-8 text-center shadow-sm"
                  role="status"
                >
                  <div
                    className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/10 text-lg"
                    aria-hidden="true"
                  >
                    ?
                  </div>

                  <p className="mt-3 font-bold">No record found</p>

                  <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-muted">
                    No member record was found for that ID number. If the office has not recorded
                    your ID yet, please ask the treasurer.
                  </p>
                </section>
              )}
            </>
          )}

          {/* =================================================
              HIS RECORD — the passbook, which lays itself out (see
              PassbookCard): his name, then where he stands, then the ledger,
              the fines and the week-by-week schedule. Full width here — the
              columns are the card's own business.
          ================================================== */}

          {foundNow && (
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
            THE GROUP — public, and clearly a different thing from
            the record above.

            It used to be two more cards in the same uniform stack, which
            made the group's own figures read as one more panel of the
            member's passbook. A rule and a heading of its own say what
            this is: the part anybody may read, with no ID at all.
        ====================================================== */}

          <section
            aria-label="About the group"
            className="space-y-5 border-t border-rule pt-6 sm:space-y-6 sm:pt-8"
          >
            <GroupOverview overview={overview} />

            {/* The constitution's own vision and mission (Chapter 2), unless the
                office has rewritten either in Settings. Last card before the footer:
                a returning member came for his record, not for a statement. */}
            <VisionMission vision={overview?.vision} mission={overview?.mission} />
          </section>
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
