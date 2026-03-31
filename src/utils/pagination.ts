/**
 * Auto-pagination helper for BPS API endpoints that support page-based pagination.
 *
 * @param fetcher Function that fetches a single page, returns { data, totalPages }
 * @param maxPages Safety limit to prevent infinite loops
 */
export async function fetchAllPages<T>(
  fetcher: (page: number) => Promise<{ data: T[]; totalPages: number }>,
  maxPages: number = 20
): Promise<T[]> {
  const allData: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await fetcher(page);
    allData.push(...result.data);
    totalPages = result.totalPages;
    page++;
  } while (page <= totalPages && page <= maxPages);

  return allData;
}
