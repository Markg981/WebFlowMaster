## 2025-02-23 - Bundle Size Optimization
**Learning:** The React application eagerly loaded all page components in `App.tsx`, causing a monolithic bundle which impacts initial load time.
**Action:** Implemented route-level code splitting using `React.lazy` and `Suspense` to load pages on demand and reduce the initial JavaScript bundle size.
