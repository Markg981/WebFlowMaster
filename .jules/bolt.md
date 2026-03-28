## 2024-05-24 - Unnecessary O(N) Re-renders on Hover
**Learning:** In a list of hundreds of `DraggableElement` components, updating a single parent state (`highlightedElement`) on hover causes all list items to re-render. This is a common React performance bottleneck when mapping over large arrays without memoization.
**Action:** Always wrap components rendered in large lists with `React.memo` if their props don't change frequently, especially when parent state updates are triggered by user interactions like hover on individual list items.
