## 2024-03-21 - React Memoization on large lists
**Learning:** DraggableElement in detectedElements map is rendered repeatedly without memoization, potentially leading to performance issues on large lists of detected elements in dashboard.
**Action:** Add React.memo to DraggableElement and other heavily listed components.
