/**
 * 分页 Hook
 */
import { useState, useMemo } from 'react';

export default function usePagination(items, pageSize) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const pageItems = useMemo(
    () => items.slice(pageStart, pageEnd),
    [items, pageStart, pageEnd]
  );

  const goPage = (p) => setCurrentPage(Math.max(1, Math.min(totalPages, p)));

  return {
    currentPage: effectivePage,
    totalPages,
    pageStart,
    pageEnd,
    pageItems,
    goPage
  };
}
