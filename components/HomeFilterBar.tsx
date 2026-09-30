"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type HomeSort = "default" | "recent" | "az" | "za" | "latest";

const SORT_OPTIONS: { id: HomeSort; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "recent", label: "Recently played" },
  { id: "az", label: "A to Z" },
  { id: "za", label: "Z to A" },
  { id: "latest", label: "Latest" },
];

interface HomeFilterBarProps {
  sort: HomeSort;
  contestOnly: boolean;
  searchOpen: boolean;
  searchQuery: string;
  onSortChange: (sort: HomeSort) => void;
  onContestOnlyChange: (on: boolean) => void;
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
}

function SortIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h10" />
      <path d="M4 12h7" />
      <path d="M4 17h4" />
      <path d="M15 7v10" />
      <path d="M15 17l3-3" />
      <path d="M15 17l-3-3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export default function HomeFilterBar({
  sort,
  contestOnly,
  searchOpen,
  searchQuery,
  onSortChange,
  onContestOnlyChange,
  onSearchOpenChange,
  onSearchQueryChange,
}: HomeFilterBarProps) {
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!sortSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sortSheetOpen]);

  const sortActive = sort !== "default";
  const sortLabel =
    SORT_OPTIONS.find((option) => option.id === sort)?.label ?? "Sort";

  const sheet =
    sortSheetOpen && mounted
      ? createPortal(
          <div
            className="home-sort-backdrop"
            role="presentation"
            onClick={() => setSortSheetOpen(false)}
          >
            <div
              className="home-sort-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-sort-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="home-sort-title" className="home-sort-title">
                Sort games
              </h2>
              <ul className="home-sort-list" role="listbox" aria-label="Sort options">
                {SORT_OPTIONS.map((option) => {
                  const selected = sort === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={
                          selected
                            ? "home-sort-option home-sort-option--active"
                            : "home-sort-option"
                        }
                        onClick={() => {
                          onSortChange(option.id);
                          setSortSheetOpen(false);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected ? (
                          <span className="home-sort-check" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="home-sort-cancel"
                onClick={() => setSortSheetOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="home-filters">
      <div className="home-filter-chips" aria-label="Browse games">
        <button
          type="button"
          className={
            sortActive || sortSheetOpen
              ? "home-filter-chip home-filter-chip--active"
              : "home-filter-chip"
          }
          aria-haspopup="dialog"
          aria-expanded={sortSheetOpen}
          onClick={() => setSortSheetOpen(true)}
        >
          <span className="home-filter-chip__icon">
            <SortIcon />
          </span>
          {sortActive ? sortLabel : "Sort"}
        </button>

        <button
          type="button"
          className={
            contestOnly
              ? "home-filter-chip home-filter-chip--active"
              : "home-filter-chip"
          }
          aria-pressed={contestOnly}
          onClick={() => onContestOnlyChange(!contestOnly)}
        >
          Contest live
        </button>

        <button
          type="button"
          className={
            searchOpen
              ? "home-filter-chip home-filter-chip--active"
              : "home-filter-chip"
          }
          aria-pressed={searchOpen}
          onClick={() => {
            const next = !searchOpen;
            onSearchOpenChange(next);
            if (!next) onSearchQueryChange("");
          }}
        >
          <span className="home-filter-chip__icon">
            <SearchIcon />
          </span>
          Search
        </button>
      </div>

      {searchOpen ? (
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

      {sheet}
    </div>
  );
}
