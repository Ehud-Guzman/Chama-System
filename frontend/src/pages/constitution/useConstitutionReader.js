// The reading experience: search, opening clauses and chapters, which chapter is in view, and the back-to-top button.
// Cut out of pages/PublicConstitution.jsx so the page file only has to arrange the screen.

import { useEffect, useMemo, useRef, useState } from "react";

export default function useConstitutionReader(constitutionChapters) {
  const [search, setSearch] = useState("");
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
   * `constitutionChapters` has to be in the dependency list: the document is
   * fetched after the first render, so on that first pass there are no chapters
   * at all. With `query` alone the memo kept handing back that empty list for the
   * rest of the session — the chapter menu listed the titles, and tapping one
   * scrolled to a section that was never rendered, which reads exactly like "the
   * chapter won't open". While the document is still loading the default `[]` is a
   * fresh array each render, so the memo simply recomputes (and finds nothing).
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
            .join(" ")
            .toLowerCase();

          return searchableText.includes(query);
        }),
      }))
      .filter((chapter) => chapter.clauses.length > 0);
  }, [query, constitutionChapters]);

  const visibleClauseCount = filteredChapters.reduce(
    (total, chapter) => total + chapter.clauses.length,
    0,
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
   * CHAPTER OPEN / CLOSE
   * ---------------------------------------------------------
   * The whole chapter at once. The chapter menu drops the reader at a chapter's
   * heading, and the first thing wanted there is its clauses — not a second tap
   * on each one. It also means "open the chapter" always does something visible,
   * which is what a reader expects a chapter heading to do.
   */
  const chapterKeys = (chapter) =>
    chapter.clauses.map((clause) => `${chapter.number}-${clause.id}`);

  const chapterIsOpen = (chapter) => {
    const keys = chapterKeys(chapter);
    return keys.length > 0 && keys.every((key) => openClauses[key]);
  };

  const toggleChapter = (chapter) => {
    const keys = chapterKeys(chapter);
    const closing = chapterIsOpen(chapter);

    setOpenClauses((current) => {
      const next = { ...current };

      keys.forEach((key) => {
        if (closing) delete next[key];
        else next[key] = true;
      });

      return next;
    });
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
   * Print / PDF prints the WHOLE text. The page prints as it is drawn, and every clause is folded shut until it is opened,
   * so the paper copy used to carry the titles of the chapters and clauses and none of the clause text. Everything is opened
   * first (the staff page does the same), printing waits a moment for it to be drawn, and what the reader had open is put
   * back afterwards.
   */
  const printWholeText = () => {
    const wasExpanded = expanded;
    const before = openClauses;
    setAllExpanded(true);
    const restore = () => {
      window.removeEventListener("afterprint", restore);
      if (!wasExpanded) {
        setExpanded(false);
        setOpenClauses(before);
      }
    };
    window.addEventListener("afterprint", restore);
    setTimeout(() => window.print(), 150);
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
            .join(" ")
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
    setSearch("");
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
      behavior: "smooth",
      block: "start",
    });

    /*
     * Small offset so the sticky header does not cover
     * the chapter title on mobile.
     */
    setTimeout(() => {
      window.scrollBy({
        top: -12,
        behavior: "smooth",
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
            visibleEntries[0].target.dataset.chapter,
          );

          if (chapterNumber) {
            setActiveChapter(chapterNumber);
          }
        }
      },
      {
        root: null,
        rootMargin: "-15% 0px -65% 0px",
        threshold: 0,
      },
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

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  /*
   * ---------------------------------------------------------
   * KEYBOARD SHORTCUT
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && search) {
        clearSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [search]);

  return {
    search,
    expanded,
    openClauses,
    activeChapter,
    showTopButton,
    chapterRefs,
    query,
    filteredChapters,
    visibleClauseCount,
    toggleClause,
    chapterIsOpen,
    toggleChapter,
    setAllExpanded,
    handleSearch,
    clearSearch,
    scrollToChapter,
    scrollToTop,
    printWholeText,
  };
}
