import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { normalizeNationalId, maskNationalId, NATIONAL_ID_ERROR } from '../../utils/nationalId';
import { passHeaders, sessionEnded } from '../../services/memberPass';
import { opensInBrowser } from '../../utils/documentFiles';
import { blobErrorMessage } from '../../utils/blobError';
import UnlockedRecords from './records/UnlockedRecords';

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
        <UnlockedRecords
          busyDocId={busyDocId}
          categories={categories}
          clearMinuteSearch={clearMinuteSearch}
          documents={documents}
          error={error}
          maskedId={maskedId}
          minuteQuery={minuteQuery}
          minuteSearch={minuteSearch}
          minuteSearching={minuteSearching}
          minutesLoading={minutesLoading}
          openDocument={openDocument}
          openMinute={openMinute}
          openMinuteDetail={openMinuteDetail}
          openingMinuteId={openingMinuteId}
          pass={pass}
          searchMinutes={searchMinutes}
          setMinuteSearch={setMinuteSearch}
          setOpenMinute={setOpenMinute}
          setTab={setTab}
          tab={tab}
          tabClass={tabClass}
          visibleMinutes={visibleMinutes}
        />
      )}
    </section>
  );
}