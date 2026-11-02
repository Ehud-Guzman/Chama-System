import CreditLine from '../../components/shared/CreditLine';
import { ChapterDecision, ClauseBody } from './shared';

export default function ConstitutionMain({ activeChapter, approvedPercent, chapterIsOpen, chapterRefs, clearSearch, constitutionMeta, decisionError, decisionsByChapter, filteredChapters, navigate, openClauses, query, recordDecision, rejectedPercent, reviewedChapters, savingChapter, scrollToTop, search, summary, toggleChapter, toggleClause, totalChapters, visibleClauseCount }) {
  return (
    <main className="constitution-main">
      {/* =================================================
          HERO
      ================================================== */}
      <button
        type="button"
        className="constitution-back-button"
        onClick={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            navigate("/");
          }
        }}
        aria-label="Go back"
      >
        <span aria-hidden="true">←</span>
        <span>Back</span>
      </button>
      <section className="constitution-hero">
        <div className="constitution-eyebrow">
          {constitutionMeta.eyebrow}
        </div>

        <h1>{constitutionMeta.title}</h1>

        <p>{constitutionMeta.description}</p>

        <div className="constitution-badges">
          {constitutionMeta.badges.map((badge) => (
            <span className="constitution-badge" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      </section>

      {/* =================================================
          DRAFT NOTICE
      ================================================== */}
      <div className="constitution-notice" role="note">
        <span className="constitution-notice-icon" aria-hidden="true">
          !
        </span>

        <div>
          <b>Draft status:</b> publication supports member review. The
          Constitution becomes binding only after lawful adoption,
          signatures and any required regulatory filing.
        </div>
      </div>

      {/* =================================================
          QUICK INFO
      ================================================== */}
      <div className="constitution-quick">
        <div className="constitution-card">
          <span className="constitution-card-icon">👥</span>
          <b>Membership</b>
          <p>
            Chapter 3 covers admission, rights, duties, resignation and
            discipline.
          </p>
        </div>

        <div className="constitution-card">
          <span className="constitution-card-icon">💰</span>
          <b>Money &amp; controls</b>
          <p>
            Chapters 7, 8, 13 and 14 cover contributions, performance,
            banking and audit.
          </p>
        </div>

        <div className="constitution-card">
          <span className="constitution-card-icon">🔎</span>
          <b>Find anything</b>
          <p>Search by chapter, clause, topic or keyword.</p>
        </div>
      </div>

      {/* =================================================
          THE MEMBER'S OWN REVIEW RECORD

          What he has approved, rejected and still has to read. Shown with
          the document rather than on a separate screen: a member decides a
          chapter the moment he has finished reading it, and this is where he
          checks that his decision went through.
      ================================================== */}
      {summary && (
        <section className="constitution-review" aria-label="Your review record">
          <div className="constitution-review-head">
            <div>
              <p className="constitution-review-eyebrow">Your review record</p>
              <p className="constitution-review-count">
                {reviewedChapters} of {totalChapters} chapters decided
              </p>
            </div>

            <span className="constitution-review-percent">
              {totalChapters
                ? `${Math.round((reviewedChapters / totalChapters) * 100)}%`
                : "0%"}
            </span>
          </div>

          <div className="constitution-review-bar" aria-hidden="true">
            <span
              className="constitution-review-bar-approved"
              style={{ width: `${approvedPercent}%` }}
            />
            <span
              className="constitution-review-bar-rejected"
              style={{ width: `${rejectedPercent}%` }}
            />
          </div>

          <ul className="constitution-review-legend">
            <li>
              <b>{summary.approved}</b> approved
            </li>
            <li>
              <b>{summary.rejected}</b> rejected
            </li>
            <li>
              <b>{summary.pending}</b> still to read
            </li>
          </ul>

          <p className="constitution-review-note">
            Decide each chapter as you finish it — approve, or reject with your
            reason. A decision is recorded once and cannot be changed, and the
            office sees it on your member record.
          </p>
        </section>
      )}

      {/* =================================================
          SEARCH STATUS
      ================================================== */}
      {query && (
        <div className="constitution-search-results">
          <div>
            <strong>
              {visibleClauseCount === 1
                ? "1 matching clause"
                : `${visibleClauseCount} matching clauses`}
            </strong>

            <span>
              {" "}
              for <b>"{search}"</b>
            </span>
          </div>

          <button
            type="button"
            onClick={clearSearch}
            className="constitution-clear-results"
          >
            Clear search
          </button>
        </div>
      )}

      {/* =================================================
          NO RESULTS
      ================================================== */}
      {query && visibleClauseCount === 0 && (
        <div className="constitution-no-results">
          <div className="constitution-no-results-icon">🔎</div>

          <h3>No matching clauses</h3>

          <p>Try a different keyword, chapter number or topic.</p>

          <button
            type="button"
            onClick={clearSearch}
            className="constitution-action"
          >
            Clear search
          </button>
        </div>
      )}

      {/* =================================================
          CHAPTERS
      ================================================== */}
      {filteredChapters.map((chapter) => (
        <section
          className={[
            "constitution-chapter",
            activeChapter === chapter.number ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id={`chapter-${chapter.number}`}
          data-chapter={chapter.number}
          key={chapter.number}
          ref={(element) => {
            chapterRefs.current[chapter.number] = element;
          }}
        >
          <header className="constitution-chapter-header">
            <div className="constitution-chapter-heading">
              <span className="constitution-chapter-no">
                Chapter {String(chapter.number).padStart(2, "0")}
              </span>

              <h2>{chapter.title}</h2>
            </div>

            <p>{chapter.description}</p>

            {/* Tapping the chapter opens every clause in it — the gesture a
                chapter heading invites, and the only way to read it without
                tapping each clause one at a time on a phone. */}
            <button
              type="button"
              className="constitution-chapter-toggle"
              onClick={() => toggleChapter(chapter)}
              aria-expanded={chapterIsOpen(chapter)}
            >
              <span aria-hidden="true">
                {chapterIsOpen(chapter) ? "−" : "+"}
              </span>
              {chapterIsOpen(chapter)
                ? `Close ${chapter.clauses.length === 1 ? "the clause" : `all ${chapter.clauses.length} clauses`}`
                : `Open ${chapter.clauses.length === 1 ? "the clause" : `all ${chapter.clauses.length} clauses`}`}
            </button>
          </header>

          <div className="constitution-clauses">
            {chapter.clauses.map((clause) => {
              const key = `${chapter.number}-${clause.id}`;
              const isOpen = Boolean(openClauses[key]);

              return (
                <article
                  className={[
                    "constitution-clause",
                    isOpen ? "is-open" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={key}
                >
                  <button
                    type="button"
                    className="constitution-clause-head"
                    aria-expanded={isOpen}
                    onClick={() => toggleClause(key)}
                  >
                    <span className="constitution-clause-id">
                      {clause.id}
                    </span>

                    <span className="constitution-clause-title">
                      {clause.title}
                    </span>

                    <span
                      className="constitution-chevron"
                      aria-hidden="true"
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>

                  {isOpen && <ClauseBody blocks={clause.blocks} />}
                </article>
              );
            })}
          </div>

          {/* His decision on this chapter, at the end of the chapter where
              he has just read it. */}
          <ChapterDecision
            chapter={chapter}
            decision={decisionsByChapter.get(chapter.number)}
            busy={savingChapter === chapter.number}
            error={
              decisionError.chapterNumber === chapter.number
                ? decisionError.message
                : ""
            }
            onDecide={(decision, reason) =>
              recordDecision(chapter.number, decision, reason)
            }
          />

          <button
            type="button"
            className="constitution-chapter-top"
            onClick={scrollToTop}
          >
            ↑ Back to top
          </button>
        </section>
      ))}

      {/* =================================================
          FOOTER
      ================================================== */}
      <footer className="constitution-footer">
        {constitutionMeta.footer}
        {/* The edition line says which document this is; the credit under it says
            who built the page it is read on. */}
        <CreditLine className="mt-2" />
      </footer>
    </main>
  );
}
