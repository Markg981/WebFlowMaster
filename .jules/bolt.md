## 2024-05-24 - [Avoid Slice in Render]
**Learning:** Performing `array.slice` on each re-render can be expensive for large data sets, leading to layout jank and high CPU usage if the array is continuously sliced without need.
**Action:** Always wrap `.slice()` calculations in `useMemo` when calculating paginated views.
