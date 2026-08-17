import { useEffect, useMemo, useRef, useState } from 'react';
import { constitutionChapters, constitutionMeta } from '../data/constitution.js';
import './PublicConstitution.css';

function ClauseBody({ blocks }) {
  return (
    <div className="constitution-clause-body">
      {blocks.map((block, index) => {
        if (block.type === 'p') {
          return <p key={index}>{block.text}</p>;
        }

        if (block.type === 'ul') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ol>
          );
        }

        return null;
      })}
    </div>
  );
}

export default function PublicConstitution() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [openClauses, setOpenClauses] = useState({});
  const [activeChapter, setActiveChapter] = useState(1);
  const [showTopButton, setShowTopButton] = useState(false);

  const chapterRefs = useRef({});

  const query = search.trim().toLowerCase();

  /*
   * ---------------------------------------------------------
   * SEARCH / FILTER
   * ---------------------------------------------------------
   */
  const filteredChapters = useMemo(() => {
    if (!query) return constitutionChapters;

    return constitutionChapters
      .map((chapter) => ({
        ...chapter,
        clauses: chapter.clauses.filter((clause) => {
          const searchableText = [
            clause.search,
            clause.title,
            clause.id,
            chapter.title,
            chapter.description,
          ]
            .join(' ')
            .toLowerCase();

          return searchableText.includes(query);
        }),
      }))
      .filter((chapter) => chapter.clauses.length > 0);
  }, [query]);

  const visibleClauseCount = filteredChapters.reduce(
    (total, chapter) => total + chapter.clauses.length,
    0
  );

  /*
   * ---------------------------------------------------------
   * CLAUSE TOGGLE
   * ---------------------------------------------------------
   */
  const toggleClause = (key) => {
    setOpenClauses((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  /*
   * ---------------------------------------------------------
   * EXPAND / COLLAPSE ALL
   * ---------------------------------------------------------
   */
  const setAllExpanded = (value) => {
    setExpanded(value);

    const next = {};

    constitutionChapters.forEach((chapter) => {
      chapter.clauses.forEach((clause) => {
        next[`${chapter.number}-${clause.id}`] = value;
      });
    });

    setOpenClauses(next);
  };

  /*
   * ---------------------------------------------------------
   * SEARCH
   * ---------------------------------------------------------
   */
  const handleSearch = (value) => {
    setSearch(value);

    if (value.trim()) {
      const next = {};

      constitutionChapters.forEach((chapter) => {
        chapter.clauses.forEach((clause) => {
          const searchableText = [
            clause.search,
            clause.title,
            clause.id,
            chapter.title,
            chapter.description,
          ]
            .join(' ')
            .toLowerCase();

          if (searchableText.includes(value.trim().toLowerCase())) {
            next[`${chapter.number}-${clause.id}`] = true;
          }
        });
      });

      setOpenClauses(next);
    }
  };

  const clearSearch = () => {
    setSearch('');
    setExpanded(false);
    setOpenClauses({});
  };

  /*
   * ---------------------------------------------------------
   * CHAPTER NAVIGATION
   * ---------------------------------------------------------
   */
  const scrollToChapter = (chapterNumber) => {
    const element = chapterRefs.current[chapterNumber];

    if (!element) return;

    setActiveChapter(chapterNumber);

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });

    /*
     * Small offset so the sticky header does not cover
     * the chapter title on mobile.
     */
    setTimeout(() => {
      window.scrollBy({
        top: -12,
        behavior: 'smooth',
      });
    }, 300);
  };

  /*
   * ---------------------------------------------------------
   * ACTIVE CHAPTER OBSERVER
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const elements = Object.values(chapterRefs.current).filter(Boolean);

    if (!elements.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visibleEntries.length) {
          const chapterNumber = Number(
            visibleEntries[0].target.dataset.chapter
          );

          if (chapterNumber) {
            setActiveChapter(chapterNumber);
          }
        }
      },
      {
        root: null,
        rootMargin: '-15% 0px -65% 0px',
        threshold: 0,
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [filteredChapters]);

  /*
   * ---------------------------------------------------------
   * BACK TO TOP
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const handleScroll = () => {
      setShowTopButton(window.scrollY > 700);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  /*
   * ---------------------------------------------------------
   * KEYBOARD SHORTCUT
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && search) {
        clearSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [search]);

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */
  return (
    <div className="constitution-page">
      {/* =====================================================
          TOP BAR
      ====================================================== */}
      <header className="constitution-topbar">
        <div className="constitution-topbar-inner">
          <button
            type="button"
            className="constitution-brand"
            onClick={scrollToTop}
            aria-label="Back to top"
          >
            WAZO MOJA
          </button>

          <div className="constitution-search">
            <span className="sr-only">Search constitution</span>

            <span className="constitution-search-icon" aria-hidden="true">
              🔎
            </span>

            <input
              type="search"
              value={search}
              onChange={(event) => handleSearch(event.target.value)}
              placeholder="Search constitution..."
              aria-label="Search constitution"
              autoComplete="off"
            />

            {search && (
              <button
                type="button"
                className="constitution-search-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="constitution-top-actions">
            <button
              type="button"
              className="constitution-action"
              onClick={() => setAllExpanded(!expanded)}
            >
              {expanded ? 'Collapse all' : 'Expand all'}
            </button>

            <button
              type="button"
              className="constitution-action"
              onClick={() => window.print()}
            >
              Print / PDF
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================
          MOBILE CHAPTER BAR
      ====================================================== */}
      <div className="constitution-mobile-nav">
        <div className="constitution-mobile-nav-inner">
          <span className="constitution-mobile-label">
            Chapter
          </span>

          <select
            value={activeChapter}
            onChange={(event) =>
              scrollToChapter(Number(event.target.value))
            }
            aria-label="Jump to chapter"
          >
            {constitutionChapters.map((chapter) => (
              <option key={chapter.number} value={chapter.number}>
                {String(chapter.number).padStart(2, '0')} — {chapter.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* =====================================================
          MAIN LAYOUT
      ====================================================== */}
      <div className="constitution-layout">
        {/* ===================================================
            DESKTOP SIDEBAR
        ==================================================== */}
        <aside
          className="constitution-sidebar"
          aria-label="Constitution chapters"
        >
          <div className="constitution-sidebar-header">
            <span>CHAPTERS</span>
            <small>{constitutionChapters.length} total</small>
          </div>

          <nav>
            {constitutionChapters.map((chapter) => {
              const isActive = activeChapter === chapter.number;

              const isHiddenBySearch =
                query &&
                !filteredChapters.some(
                  (item) => item.number === chapter.number
                );

              return (
                <button
                  type="button"
                  key={chapter.number}
                  className={[
                    'constitution-nav-link',
                    isActive ? 'is-active' : '',
                    isHiddenBySearch
                      ? 'constitution-nav-link-muted'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => scrollToChapter(chapter.number)}
                >
                  <span className="constitution-nav-number">
                    {String(chapter.number).padStart(2, '0')}
                  </span>

                  <span className="constitution-nav-title">
                    {chapter.title}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ===================================================
            MAIN CONTENT
        ==================================================== */}
        <main className="constitution-main">
          {/* =================================================
              HERO
          ================================================== */}
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
              <b>Draft status:</b> publication supports member review.
              The Constitution becomes binding only after lawful adoption,
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
                Chapter 3 covers admission, rights, duties,
                resignation and discipline.
              </p>
            </div>

            <div className="constitution-card">
              <span className="constitution-card-icon">💰</span>
              <b>Money &amp; controls</b>
              <p>
                Chapters 7, 8, 13 and 14 cover contributions,
                performance, banking and audit.
              </p>
            </div>

            <div className="constitution-card">
              <span className="constitution-card-icon">🔎</span>
              <b>Find anything</b>
              <p>
                Search by chapter, clause, topic or keyword.
              </p>
            </div>
          </div>

          {/* =================================================
              SEARCH STATUS
          ================================================== */}
          {query && (
            <div className="constitution-search-results">
              <div>
                <strong>
                  {visibleClauseCount === 1
                    ? '1 matching clause'
                    : `${visibleClauseCount} matching clauses`}
                </strong>

                <span>
                  {' '}
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
              <div className="constitution-no-results-icon">
                🔎
              </div>

              <h3>No matching clauses</h3>

              <p>
                Try a different keyword, chapter number or topic.
              </p>

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
                'constitution-chapter',
                activeChapter === chapter.number ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
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
                    Chapter {String(chapter.number).padStart(2, '0')}
                  </span>

                  <h2>{chapter.title}</h2>
                </div>

                <p>{chapter.description}</p>
              </header>

              <div className="constitution-clauses">
                {chapter.clauses.map((clause) => {
                  const key = `${chapter.number}-${clause.id}`;
                  const isOpen = Boolean(openClauses[key]);

                  return (
                    <article
                      className={[
                        'constitution-clause',
                        isOpen ? 'is-open' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
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
                          {isOpen ? '−' : '+'}
                        </span>
                      </button>

                      {isOpen && (
                        <ClauseBody blocks={clause.blocks} />
                      )}
                    </article>
                  );
                })}
              </div>

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
          </footer>
        </main>
      </div>

      {/* =====================================================
          FLOATING BACK TO TOP
      ====================================================== */}
      {showTopButton && (
        <button
          type="button"
          className="constitution-floating-top"
          onClick={scrollToTop}
          aria-label="Back to top"
          title="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}