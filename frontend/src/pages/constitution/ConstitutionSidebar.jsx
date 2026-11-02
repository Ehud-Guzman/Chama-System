export default function ConstitutionSidebar({ activeChapter, constitutionChapters, filteredChapters, query, scrollToChapter }) {
  return (
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
              (item) => item.number === chapter.number,
            );

          return (
            <button
              type="button"
              key={chapter.number}
              className={[
                "constitution-nav-link",
                isActive ? "is-active" : "",
                isHiddenBySearch ? "constitution-nav-link-muted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => scrollToChapter(chapter.number)}
            >
              <span className="constitution-nav-number">
                {String(chapter.number).padStart(2, "0")}
              </span>

              <span className="constitution-nav-title">
                {chapter.title}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
