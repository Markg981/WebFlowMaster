# Contributing to Self-Healing Integration 🤝

This guide explains how to extend the AI Self-Healing capabilities of WebFlowMaster.

## 🧠 Core Architecture

The Self-Healing logic resides in `server/ai-automation-service.ts`. It works by:

1.  Receiving a specific Playwright error (Timeout).
2.  Capturing the DOM.
3.  Sending a structured prompt to Gemini.
4.  Validating the response.

## 🚀 Extending Capabilities

### 1. Supporting Shadow DOM

Currently, `page.content()` might not fully capture open Shadow Roots. To support Shadow DOM components (like Web Components):

**Modify `server/playwright-reporter.ts`**:
Instead of just `page.content()`, implement a traversal function that pierces Shadow roots:

```typescript
// Suggestion for PlaywrightReporter.ts inside attemptHeal()
const fullSnapshot = await this.page.evaluate(() => {
  // Custom script to traverse shadowRoots and serialize full tree
  return document.body.innerHTML; // Replace with robust deep serialization
});
```

### 2. Adding iFrame Support

To support iFrames, you need to pass the **Frame** context to the AI service, not just the main page.

1.  Update `PlaywrightReporter` to track the current `Frame` object.
2.  In `attemptHeal`, if a frame is active, grab the frame's content:
    ```typescript
    const content = this.activeFrame
      ? await this.activeFrame.content()
      : await this.page.content();
    ```

### 3. Improving Prompt Engineering

To make the AI smarter for complex grids or dynamic IDs, edit the `healSelector` method in `server/ai-automation-service.ts`.

- **Add Attributes**: Explicitly ask Gemini to prefer `data-testid` or `aria-label` over complex CSS chains.
- **Context**: You can pass the _Previous Sibling_ or _Parent Text_ to the prompt to give Gemini more positional clues.

### 4. Adding New Element Types

If you add a new action (e.g., "Drag"), ensure you handle the failure block in `PlaywrightReporter`:

```typescript
async drag(source: string, target: string) {
    try {
        // ...
    } catch(e) {
        // Implement healing logic for both Source and Target!
        const newSource = await this.attemptHeal(source, e.message);
        // ...
    }
}
```

## 🧪 Testing Your Changes

1.  Create a test case with a "Broken" selector (edit the DB directly).
2.  Run the test.
3.  Observe the server logs for `[AI] Healing` messages.
