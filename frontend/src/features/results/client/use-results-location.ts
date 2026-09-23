"use client";

import { useSearchParams } from "next/navigation";

export function useResultsLocation() {
  const params = useSearchParams();

  function update(values: Record<string, string | null>) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "" || value === "all")
        url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  return { params, update };
}
