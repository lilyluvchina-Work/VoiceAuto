/**
 * 多选 Hook
 */
import { useState, useCallback } from 'react';

export default function useSelection() {
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggle = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids) => {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
  }, []);

  const remove = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = useCallback((ids) => {
    return ids.length > 0 && ids.every(id => selectedIds.has(id));
  }, [selectedIds]);

  return { selectedIds, toggle, selectAll, remove, clear, isAllSelected };
}
