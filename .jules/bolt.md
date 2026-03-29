## 2024-05-24 - Optimizing large lists in React with React.memo
**Learning:** Re-rendering a large list of stable items (like the detected elements on DashboardPage) when a non-related parent state changes (like hovering to set `highlightedElement`) can cause significant performance bottlenecks in React.
**Action:** Always wrap list item components in `React.memo` if they depend on stable props but their parent re-renders frequently, to prevent unnecessary reconciliations.
