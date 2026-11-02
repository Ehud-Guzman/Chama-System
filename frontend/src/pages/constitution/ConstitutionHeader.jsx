import { CHAMA_NAME_TOP } from '../../utils/branding';

export default function ConstitutionHeader({ clearSearch, expanded, handleSearch, printWholeText, scrollToTop, search, setAllExpanded }) {
  return (
    <header className="constitution-topbar">
      <div className="constitution-topbar-inner">
        <button
          type="button"
          className="constitution-brand"
          onClick={scrollToTop}
          aria-label="Back to top"
        >
          {CHAMA_NAME_TOP}
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
            {expanded ? "Collapse all" : "Expand all"}
          </button>

          <button
            type="button"
            className="constitution-action"
            onClick={printWholeText}
          >
            Print / PDF
          </button>
        </div>
      </div>
    </header>
  );
}
