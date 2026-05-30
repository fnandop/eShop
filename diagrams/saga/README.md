# Saga Diagram Specs

These JSON files are the declarative source for the animated saga diagrams in `img/`.

Regenerate the APNGs from the repository root:

```powershell
npm run generate:saga-diagrams
```

Each spec defines:

- `participants`: vertical lanes in the diagram.
- `steps`: ordered messages, events, activities, signals, timers, and results.
- `terminal`: the final rounded state shown only after a selected step.
- `durationsMs`: APNG frame timing.

The renderer writes full-canvas APNG frames so Markdown/browser viewers do not crop frames differently during playback.
