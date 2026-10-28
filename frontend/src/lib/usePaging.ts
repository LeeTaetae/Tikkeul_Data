import { useState } from 'react';

// 항목이 많을 때 처음 pageSize 개만 보여주고, 더 보기를 누르면 전부 보여준다.
export function usePaging<T>(items: T[], pageSize = 15) {
  const [limit, setLimit] = useState(pageSize);
  return {
    visible: items.slice(0, limit),
    remaining: Math.max(0, items.length - limit),
    showAll: () => setLimit(Number.MAX_SAFE_INTEGER),
  };
}
