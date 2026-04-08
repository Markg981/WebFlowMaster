## 2026-04-08 - Fix Playwright Browser Pool Leak
**Learning:** Using `browser.close()` on a browser acquired from `BrowserPool` bypasses the `release()` mechanism, leaving the pool item marked as `inUse: true` forever. This causes a memory leak and forces the pool to launch expensive overflow browsers once the limit is reached.
**Action:** Always use `await (await browserPool).release(browser)` in the `finally` block for pooled browser instances instead of `browser.close()`, and ensure `page` and `context` are closed first.
