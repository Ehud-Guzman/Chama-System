import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { normalizeNationalId, maskNationalId, NATIONAL_ID_ERROR } from '../../utils/nationalId';
import { passHeaders, sessionEnded } from '../../services/memberPass';
import { shortDate, formatBytes } from '../../utils/format';
import { pageCountLabel, pageCountTitle } from '../../utils/minutePages';
import { documentCategoryLabel } from '../../utils/documentCategories';
import { opensInBrowser } from '../../utils/documentFiles';
import { blobErrorMessage } from '../../utils/blobError';
import HighlightedText from '../shared/HighlightedText';

// The minute reader is the rich-text editor's parser and schema. Loading it with
// the page put Tiptap and ProseMirror (~180 KB gzip) in the members' page bundle
// for everyone who ever opens a link — most of whom come to see a balance. It now
// arrives only when a member actually opens a minute.
const MinutesReader = lazy(() => import('../minutes/MinutesReader'));

// The members' area: the chama's documents (title deeds, certificates), the
// meeting minutes, and the constitution, behind one ID gate. A successful passbook
// lookup counts as having entered an ID, so the pass it earned (`verifiedPass`) opens it without
// asking twice.
//
// The ID is spent once, at the gate below (or at the lookup), and what comes back is a pass for
// that member that every request after carries in a header. Every tab is served by an endpoint
// that checks the pass itself — the gate below is a convenience, never the protection. Anything that must not be
// public is not in the app bundle either: the constitution is a server-side
// document now, not a page anyone can read from the source.
export default function PublicRecords({ verifiedPass = '', verifiedMask = '' }) {
  const [id, setId] = useState('');
  // The pass, and the masked ID that says whose it is. The number itself is not kept.
  const [pass, setPass] = useState('');
  const [maskedId, setMaskedId] = useState('');
  const [status, setStatus] = useState('locked'); // locked | loading | unlocked | error
  const [error, setError] = useState('');
  const [tab, setTab] = useState('documents');

  const [documents, setDocuments] = useState([]);
  // The headings the group files its papers under, straight from the server — the
  // list is the office's now, so a heading they added reads correctly here too.
  const [categories, setCategories] = useState([]);
  const [busyDocId, setBusyDocId] = useState(null);

  const [minutes, setMinutes] = useState([]);
  const [minutesLoaded, setMinutesLoaded] = useState(false);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [openMinute, setOpenMinute] = useState(null);
  const [openingMinuteId, setOpeningMinuteId] = useState(null);
  // Searching the minutes. `minuteSearch` is what is in the box; `minuteQuery` is
  // the term the server has actually answered for, which is the one the results are
  // highlighted with. `minuteResults` null means the tab is showing every published
  // minute.
  const [minuteSearch, setMinuteSearch] = useState('');
  const [minuteQuery, setMinuteQuery] = useState('');
  const [minuteResults, setMinuteResults] = useState(null);
  const [minuteSearching, setMinuteSearching] = useState(false);

  // Opening the area with a pass already in hand. The documents list doubles as the gate: it only
  // answers for a pass that is still good, and an empty vault still answers 200.
  const openWithPass = useCallback(async (token, mask) => {
    setStatus('loading');
    setError('');

    try {
      const res = await api.get('/api/public/documents', { headers: passHeaders(token) });
      setDocuments(res.data.documents || []);
      setCategories(res.data.categories || []);
      setPass(token);
      setMaskedId(mask);
      setTab('documents');
      setMinutes([]);
      setMinutesLoaded(false);
      setOpenMinute(null);
      setMinuteSearch('');
      setMinuteQuery('');
      setMinuteResults(null);
      setStatus('unlocked');
    } catch (err) {
      setDocuments([]);
      setCategories([]);
      setPass('');
      setMaskedId('');
      setStatus('error');
      setError(apiMessage(err, 'Could not fetch the records right now. Please try again.'));
    }
  }, []);

  // The ID, once: the records gate asks for it, trades it for a pass, and does not keep it.
  const unlock = useCallback(
    async (rawId) => {
      const normalized = normalizeNationalId(rawId);

      if (!normalized) {
        setStatus('error');
        setError(NATIONAL_ID_ERROR);
        return;
      }

      setStatus('loading');
      setError('');

      try {
        const res = await api.post('/api/public/records/unlock', { nationalId: normalized });
        await openWithPass(res.data.memberToken, maskNationalId(normalized));
      } catch (err) {
        setDocuments([]);
        setCategories([]);
        setPass('');
        setMaskedId('');
        setStatus('error');
        setError(
          err.response?.status === 404
            ? 'That ID is not recorded against any active member. Check the number, or ask the treasurer to add it.'
            : apiMessage(err, 'Could not fetch the records right now. Please try again.')
        );
      }
    },
    [openWithPass]
  );

  useEffect(() => {
    if (verifiedPass) openWithPass(verifiedPass, verifiedMask);
  }, [verifiedPass, verifiedMask, openWithPass]);

  // A pass that has run out (an hour), been refused, or belongs to somebody who has left: back to the
  // gate, in words, rather than a tab that quietly stops working.
  const endSession = useCallback((err) => {
    setPass('');
    setMaskedId('');
    setDocuments([]);
    setMinutes([]);
    setMinutesLoaded(false);
    setOpenMinute(null);
    setMinuteResults(null);
    setTab('documents');
    setStatus('error');
    setError(apiMessage(err, 'Your session has ended. Enter your ID number again.'));
  }, []);

  // Minutes are fetched the first time that tab is opened, not on unlock —
  // they're long documents, and most visits are for the ledger above.
  useEffect(() => {
    if (status !== 'unlocked' || tab !== 'minutes' || minutesLoaded) return undefined;

    let cancelled = false;
    setMinutesLoading(true);
    api
      .get('/api/public/minutes', { headers: passHeaders(pass) })
      .then((res) => {
        if (cancelled) return;
        setMinutes(res.data.minutes || []);
        setMinutesLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        if (sessionEnded(err)) endSession(err);
        else setError(apiMessage(err, 'Could not load the minutes right now.'));
      })
      .finally(() => {
        if (!cancelled) setMinutesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, tab, minutesLoaded, pass, endSession]);

  function lock() {
    setId('');
    setPass('');
    setMaskedId('');
    setDocuments([]);
    setMinutes([]);
    setMinutesLoaded(false);
    setOpenMinute(null);
    setMinuteSearch('');
    setMinuteQuery('');
    setMinuteResults(null);
    setError('');
    setTab('documents');
    setStatus('locked');
  }

  function onSubmit(e) {
    e.preventDefault();
    unlock(id);
  }

  async function openDocument(doc, download) {
    setBusyDocId(doc.id);
    setError('');
    try {
      const res = await api.get(`/api/public/documents/${doc.id}/file`, {
        params: { download: download ? 1 : undefined },
        headers: passHeaders(pass),
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);

      if (!download && opensInBrowser(doc.mimeType)) {
        window.open(url, '_blank', 'noopener');
        // Give the new tab time to load before dropping the blob URL
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName || 'document';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (sessionEnded(err)) endSession(err);
      else setError(await blobErrorMessage(err, 'Could not open that document. Please try again.'));
    } finally {
      setBusyDocId(null);
    }
  }

  async function openMinuteDetail(id) {
    setOpeningMinuteId(id);
    setError('');
    try {
      const res = await api.get(`/api/public/minutes/${id}`, { headers: passHeaders(pass) });
      setOpenMinute(res.data.minute);
    } catch (err) {
      if (sessionEnded(err)) endSession(err);
      else setError(apiMessage(err, 'Could not open that minute. Please try again.'));
    } finally {
      setOpeningMinuteId(null);
    }
  }

  // Any word from any meeting, searched where the words actually are: in the minute's
  // body, which this list never carries. It is submitted rather than typed-ahead of
  // purpose — the endpoint is ID-gated and budgeted at thirty requests a minute, and
  // typing one word should not spend ten of them.
  async function searchMinutes(e) {
    e.preventDefault();
    const term = minuteSearch.trim();
    setError('');

    if (!term) {
      setMinuteQuery('');
      setMinuteResults(null);
      return;
    }

    setMinuteSearching(true);
    try {
      const res = await api.get('/api/public/minutes', {
        params: { q: term },
        headers: passHeaders(pass),
      });
      setMinuteResults(res.data.minutes || []);
      // The term the answer belongs to, so what is highlighted on screen is what was
      // actually searched for.
      setMinuteQuery(term);
    } catch (err) {
      if (sessionEnded(err)) endSession(err);
      else setError(apiMessage(err, 'Could not search the minutes right now.'));
    } finally {
      setMinuteSearching(false);
    }
  }

  function clearMinuteSearch() {
    setMinuteSearch('');
    setMinuteQuery('');
    setMinuteResults(null);
  }

  const tabClass = (name) =>
    `min-h-11 rounded-lg px-3 text-xs font-bold transition ${
      tab === name ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-primary'
    }`;

  // What the Minutes tab is showing: the search answer when there is one, the whole
  // published list otherwise.
  const visibleMinutes = minuteResults || minutes;

  return (
    <section className="rounded-2xl border border-rule bg-surface p-4 shadow-sm sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center lg:gap-x-10">
      {/* The header spans the whole card once the gate is out of the way, so the
          Lock button lands on the card's right edge instead of at the end of the
          narrower first column (where the ID field sits while still locked). */}
      <div
        className={`flex items-start justify-between gap-3 lg:col-start-1 lg:row-start-1 ${
          status === 'unlocked' ? 'lg:col-span-2' : ''
        }`}
      >
        <div className="min-w-0">
          <h2 className="text-base font-bold sm:text-lg">Documents, minutes &amp; constitution</h2>
          <p className="mt-1 text-xs leading-5 text-muted sm:text-sm">
            Title deeds, certificates, meeting minutes and the constitution. Shown only after you
            enter the ID number registered with the chama.
          </p>
        </div>

        {/* The lock control is a real button on a phone, not a text link: this is
            the only way a member on a shared handset closes his own record. */}
        {status === 'unlocked' && (
          <button
            type="button"
            onClick={lock}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-rule px-3 text-sm font-medium text-muted"
          >
            Lock
          </button>
        )}
      </div>

      {/* The one field the gate needs, on its own column beside the explanation
          once there is room — the same shape the page's hero uses, rather than a
          short form left stranded in a desktop-wide card. */}
      {status !== 'unlocked' && (
        <form
          onSubmit={onSubmit}
          className="mt-5 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:w-full"
          noValidate
        >
          <label htmlFor="records-id" className="mb-2 block text-sm font-semibold">
            ID number
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="records-id"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="12345678"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                if (status === 'error') {
                  setStatus('locked');
                  setError('');
                }
              }}
              aria-invalid={status === 'error'}
              className="amount h-12 w-full rounded-xl border border-rule bg-page px-4 text-base"
            />

            <button
              type="submit"
              disabled={status === 'loading'}
              className="min-h-12 shrink-0 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {status === 'loading' ? 'Opening…' : 'View records'}
            </button>
          </div>

          {status === 'error' && error && (
            <p className="mt-2 text-sm font-medium text-alert" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {status === 'unlocked' && (
        <div className="mt-4 lg:col-span-2 lg:mt-5">
          {error && (
            <p className="mb-3 text-sm font-medium text-alert" role="alert">
              {error}
            </p>
          )}

          <div
            className="grid w-full grid-cols-3 rounded-xl border border-rule bg-page p-1 sm:max-w-md"
            role="tablist"
            aria-label="Chama records"
          >
            <button
              type="button"
              role="tab"
              id="records-tab-documents"
              aria-controls="records-panel-documents"
              aria-selected={tab === 'documents'}
              onClick={() => setTab('documents')}
              className={tabClass('documents')}
            >
              Documents
            </button>
            <button
              type="button"
              role="tab"
              id="records-tab-minutes"
              aria-controls="records-panel-minutes"
              aria-selected={tab === 'minutes'}
              onClick={() => {
                setOpenMinute(null);
                setTab('minutes');
              }}
              className={tabClass('minutes')}
            >
              Minutes
            </button>
            <button
              type="button"
              role="tab"
              id="records-tab-constitution"
              aria-controls="records-panel-constitution"
              aria-selected={tab === 'constitution'}
              onClick={() => {
                setOpenMinute(null);
                setTab('constitution');
              }}
              className={tabClass('constitution')}
            >
              Constitution
            </button>
          </div>

          {tab === 'documents' && (
            <div
              role="tabpanel"
              id="records-panel-documents"
              aria-labelledby="records-tab-documents"
              className="mt-4"
            >
              {documents.length === 0 ? (
                <p className="rounded-xl border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
                  No documents have been published yet.
                </p>
              ) : (
                <ul className="space-y-2">
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="rounded-xl border border-rule bg-page px-4 py-3 lg:flex lg:items-start lg:justify-between lg:gap-6"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{doc.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {documentCategoryLabel(doc.category, categories, doc.categoryLabel)} ·{' '}
                        {shortDate(doc.uploadedAt)}
                      </p>
                      {doc.description && (
                        <p className="mt-1 text-xs leading-5 text-muted">{doc.description}</p>
                      )}
                      <p className="amount mt-1 truncate text-[11px] text-muted">
                        {doc.fileName} · {formatBytes(doc.size)}
                      </p>
                    </div>

                    {/* Beside the details once there is room, instead of stretching
                        two buttons across a desktop-wide card. */}
                    <div className="mt-3 flex gap-2 lg:mt-0 lg:w-56 lg:shrink-0">
                      <button
                        type="button"
                        onClick={() => openDocument(doc, false)}
                        disabled={busyDocId === doc.id}
                        className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium text-primary disabled:opacity-60"
                      >
                        {busyDocId === doc.id ? 'Opening…' : 'View'}
                      </button>

                      <button
                        type="button"
                        onClick={() => openDocument(doc, true)}
                        disabled={busyDocId === doc.id}
                        className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium disabled:opacity-60"
                      >
                        Download
                      </button>
                    </div>
                  </li>
                ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'minutes' && openMinute && (
            <div
              role="tabpanel"
              id="records-panel-minutes"
              aria-labelledby="records-tab-minutes"
              className="mt-4 overflow-hidden rounded-xl border border-rule"
            >
              <div className="flex items-start justify-between gap-3 bg-page p-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold">{openMinute.title}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {shortDate(openMinute.date)}
                    {/* How long the minute he has just opened is — the same figure the office
                        reads on its own copy of it, so the two can never disagree. */}
                    {pageCountLabel(openMinute.pages) && (
                      <span className="amount" title={pageCountTitle(openMinute.pages)}>
                        {' · '}
                        {pageCountLabel(openMinute.pages)}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenMinute(null)}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-rule px-3 text-sm font-medium"
                >
                  ← Back
                </button>
              </div>
              <div className="bg-surface px-4 py-3">
                {/* The editor is a ~650 KB library. It arrives with the minute it
                    renders, not with the page: a member checking his balance should
                    not download ProseMirror to do it. */}
                <Suspense
                  fallback={<p className="py-4 text-center text-sm text-muted">Loading minute…</p>}
                >
                  <MinutesReader key={openMinute.id} content={openMinute.content} />
                </Suspense>
              </div>
            </div>
          )}

          {tab === 'minutes' && !openMinute && (
            <div
              role="tabpanel"
              id="records-panel-minutes"
              aria-labelledby="records-tab-minutes"
            >
              {/* Any word from any meeting. Submitted rather than searched as it is
                  typed: the words are in the minute's body, which this list never
                  carries, so the search is a request to the API — and that endpoint is
                  ID-gated and budgeted, which typing letter by letter would spend. */}
              <form
                onSubmit={searchMinutes}
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                noValidate
              >
                <span className="sr-only">Search the minutes</span>
                <input
                  type="search"
                  value={minuteSearch}
                  onChange={(e) => setMinuteSearch(e.target.value)}
                  placeholder="Search any word from the meetings…"
                  aria-label="Search the minutes"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-12 w-full rounded-xl border border-rule bg-page px-4 text-base"
                />

                <button
                  type="submit"
                  disabled={minuteSearching}
                  className="min-h-12 shrink-0 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {minuteSearching ? 'Searching…' : 'Search'}
                </button>
              </form>

              {minuteQuery && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    {visibleMinutes.length > 0
                      ? `${visibleMinutes.length} ${
                          visibleMinutes.length === 1 ? 'minute' : 'minutes'
                        } mention “${minuteQuery}”.`
                      : `No minute mentions “${minuteQuery}”.`}
                  </p>

                  <button
                    type="button"
                    onClick={clearMinuteSearch}
                    className="min-h-11 px-2 text-xs font-semibold text-primary"
                  >
                    Show all minutes
                  </button>
                </div>
              )}

              {minutesLoading ? (
                <p className="mt-4 text-center text-sm text-muted">Loading minutes…</p>
              ) : visibleMinutes.length === 0 ? (
                // A search that found nothing has already been said above; only an
                // empty vault needs saying here.
                minuteQuery ? null : (
                  <p className="mt-4 rounded-xl border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
                    No minutes have been published yet.
                  </p>
                )
              ) : (
                <ul className="mt-4 space-y-2">
                  {visibleMinutes.map((m) => {
                    const pages = pageCountLabel(m.pages);
                    return (
                    <li
                      key={m.id}
                      className="rounded-xl border border-rule bg-page px-4 py-3 lg:flex lg:items-center lg:justify-between lg:gap-6"
                    >
                      <div className="min-w-0">
                        <HighlightedText
                          text={m.title}
                          term={minuteQuery}
                          className="block text-sm font-semibold"
                        />
                        <p className="mt-0.5 text-xs text-muted">
                          {shortDate(m.date)}
                          {/* How long it is, before he spends his bundle opening it — and the same
                              figure the office reads on its own copy (utils/minutePages). */}
                          {pages ? ` · ${pages}` : ''}
                        </p>
                        {m.preview && (
                          <HighlightedText
                            // A search result's preview is the sentence the word was
                            // found in and already ends in an ellipsis; a browse
                            // preview is the minute's opening words and needs one.
                            text={m.preview.endsWith('…') ? m.preview : `${m.preview}…`}
                            term={minuteQuery}
                            className="mt-1 block text-xs leading-5 text-muted"
                          />
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => openMinuteDetail(m.id)}
                        disabled={openingMinuteId === m.id}
                        className="mt-3 min-h-11 w-full rounded-lg border border-rule text-sm font-medium text-primary disabled:opacity-60 lg:mt-0 lg:w-40 lg:shrink-0"
                      >
                        {openingMinuteId === m.id ? 'Opening…' : 'Read minute'}
                      </button>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* The constitution sits with the other members' documents. The page it
              opens fetches the text from the server for this same ID, so the
              handover carries the number rather than making the member type it
              again. */}
          {tab === 'constitution' && (
            <div
              role="tabpanel"
              id="records-panel-constitution"
              aria-labelledby="records-tab-constitution"
              className="mt-4 rounded-xl border border-rule bg-page px-4 py-5"
            >
              <p className="text-sm font-semibold">The group&rsquo;s constitution</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                Every clause, searchable and printable — the governance and
                financial-management rules this ledger is run by.
              </p>

              <Link
                to="/constitution"
                state={{ memberToken: pass, maskedId }}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white"
              >
                Read the constitution
              </Link>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted">
            Unlocked for {maskedId} — records stay visible until you lock them, leave the page, or an hour
            passes.
          </p>
        </div>
      )}
    </section>
  );
}