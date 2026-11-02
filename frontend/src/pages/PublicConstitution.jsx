import { useLocation, useNavigate } from "react-router-dom";
import "../components/public/constitution.css";
import ConstitutionHeader from './constitution/ConstitutionHeader';
import ConstitutionSidebar from './constitution/ConstitutionSidebar';
import ConstitutionMain from './constitution/ConstitutionMain';
import useConstitutionAccess from './constitution/useConstitutionAccess';
import useConstitutionDecisions from './constitution/useConstitutionDecisions';
import useConstitutionReader from './constitution/useConstitutionReader';
import ConstitutionGate from './constitution/ConstitutionGate';

export default function PublicConstitution() {
  const navigate = useNavigate();
  const location = useLocation();

  // Arriving from the members' area, the pass it earned comes with the link: the ID is not carried
  // from page to page, only the one-hour pass for it.
  const linkedPass = location.state?.memberToken || "";
  const { id, setId, status, setStatus, gateError, setGateError, doc, pass, summary, setSummary, onSubmitGate } =
    useConstitutionAccess(linkedPass);

  // The document's shape is unchanged from when it lived in the bundle: a meta
  // block and the chapters. Aliased to the names the rest of the file uses.
  const { meta: constitutionMeta = {}, chapters: constitutionChapters = [] } = doc || {};

  const {
    search,
    expanded,
    activeChapter,
    showTopButton,
    chapterRefs,
    query,
    openClauses,
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
  } = useConstitutionReader(constitutionChapters);

  const {
    savingChapter,
    decisionError,
    decisionsByChapter,
    reviewedChapters,
    totalChapters,
    approvedPercent,
    rejectedPercent,
    recordDecision,
  } = useConstitutionDecisions({ pass, summary, setSummary });

  /*
   * ---------------------------------------------------------
   * RENDER — locked: no number, no document
   * ---------------------------------------------------------
   * Nothing of the constitution is on the page, or in the bundle, until the
   * server answers for a registered number.
   */
  if (status !== "unlocked") {
    return (
      <ConstitutionGate
        gateError={gateError}
        id={id}
        navigate={navigate}
        onSubmitGate={onSubmitGate}
        setGateError={setGateError}
        setId={setId}
        setStatus={setStatus}
        status={status}
      />
    );
  }

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

      <ConstitutionHeader
        clearSearch={clearSearch}
        expanded={expanded}
        handleSearch={handleSearch}
        printWholeText={printWholeText}
        scrollToTop={scrollToTop}
        search={search}
        setAllExpanded={setAllExpanded}
      />

      {/* =====================================================
          MOBILE CHAPTER BAR
      ====================================================== */}
      <div className="constitution-mobile-nav">
        <div className="constitution-mobile-nav-inner">
          <span className="constitution-mobile-label">Chapter</span>

          <select
            value={activeChapter}
            onChange={(event) => scrollToChapter(Number(event.target.value))}
            aria-label="Jump to chapter"
          >
            {constitutionChapters.map((chapter) => (
              <option key={chapter.number} value={chapter.number}>
                {String(chapter.number).padStart(2, "0")} — {chapter.title}
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
        <ConstitutionSidebar
          activeChapter={activeChapter}
          constitutionChapters={constitutionChapters}
          filteredChapters={filteredChapters}
          query={query}
          scrollToChapter={scrollToChapter}
        />

        {/* ===================================================
            MAIN CONTENT
        ==================================================== */}
        <ConstitutionMain
          activeChapter={activeChapter}
          approvedPercent={approvedPercent}
          chapterIsOpen={chapterIsOpen}
          chapterRefs={chapterRefs}
          clearSearch={clearSearch}
          constitutionMeta={constitutionMeta}
          decisionError={decisionError}
          decisionsByChapter={decisionsByChapter}
          filteredChapters={filteredChapters}
          navigate={navigate}
          openClauses={openClauses}
          query={query}
          recordDecision={recordDecision}
          rejectedPercent={rejectedPercent}
          reviewedChapters={reviewedChapters}
          savingChapter={savingChapter}
          scrollToTop={scrollToTop}
          search={search}
          summary={summary}
          toggleChapter={toggleChapter}
          toggleClause={toggleClause}
          totalChapters={totalChapters}
          visibleClauseCount={visibleClauseCount}
        />
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
