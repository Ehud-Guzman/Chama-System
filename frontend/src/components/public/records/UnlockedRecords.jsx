import { documentCategoryLabel } from '../../../utils/documentCategories';
import { shortDate, formatBytes } from '../../../utils/format';
import { pageCountLabel, pageCountTitle } from '../../../utils/minutePages';
import { Suspense } from 'react';
import HighlightedText from '../../shared/HighlightedText';
import { Link } from 'react-router-dom';
import { MinutesReader } from './shared';

export default function UnlockedRecords({ busyDocId, categories, clearMinuteSearch, documents, error, maskedId, minuteQuery, minuteSearch, minuteSearching, minutesLoading, openDocument, openMinute, openMinuteDetail, openingMinuteId, pass, searchMinutes, setMinuteSearch, setOpenMinute, setTab, tab, tabClass, visibleMinutes }) {
  return (
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
  );
}
