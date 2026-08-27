"use client";

export type HomeFilter = "all" | "recent" | "contest" | "search";

const FILTERS: { id: HomeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recently played" },
  { id: "contest", label: "Contest live" },
  { id: "search", label: "Search" },
];

interface HomeFilterBarProps {
  filter: HomeFilter;
  searchQuery: string;
  onFilterChange: (filter: HomeFilter) => void;
  onSearchQueryChange: (query: string) => void;
}

export default function HomeFilterBar({
  filter,
  searchQuery,
  onFilterChange,
  onSearchQueryChange,
}: HomeFilterBarProps) {
  return (
    <div className="home-filters">
      <div
        className="home-filter-chips"
        role="tablist"
        aria-label="Browse games"
      >
        {FILTERS.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={
                selected
                  ? "home-filter-chip home-filter-chip--active"
                  : "home-filter-chip"
              }
              onClick={() => onFilterChange(item.id)}
            >
              {item.id === "search" ? (
                <span className="home-filter-chip__search-icon" aria-hidden>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                </span>
              ) : null}
              {item.label}
            </button>
          );
        })}
      </div>

      {filter === "search" ? (
        <div className="home-search">
          <label className="visually-hidden" htmlFor="home-game-search">
            Search games
          </label>
          <input
            id="home-game-search"
            className="home-search-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search games…"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            autoFocus
          />
          {searchQuery ? (
            <button
              type="button"
              className="home-search-clear"
              aria-label="Clear search"
              onClick={() => onSearchQueryChange("")}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
