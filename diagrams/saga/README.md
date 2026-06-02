# Saga Diagram Specs

These Mermaid files are the declarative source for the animated saga diagrams in `img/`.

Regenerate the GIFs from the repository root:

```powershell
npm run generate:saga-diagrams
```

You can also run the renderer directly as a command-line tool:

```powershell
node scripts/render-mermaid-animation.mjs diagrams/saga/EShopSaga-happy.mmd --output img/custom-saga.gif
node scripts/render-mermaid-animation.mjs diagrams/saga/*.mmd --out-dir img
```

If the package is linked or installed, the same CLI is exposed as `mermaid-animate`.

Each `.mmd` file is a normal Mermaid sequence diagram with a few renderer comments:

- `%% output:`: where the generated animated GIF is written.
- `%% delay:`: frame delay in milliseconds.
- `%% width:` and `%% height:`: output canvas size.
- `%% title:`: heading rendered above the diagram.
- `%% frame:`: starts a new animation frame. The renderer progressively reveals Mermaid lines through that frame.

Icon conventions:

- `✉`: choreographed integration-event message.
- `🔗 API`: orchestrated workflow activity/API request.
- `⚡ Signal`: external Temporal signal.
- `⏱`: timer, delay, or polling step.
- `✅` / `❌`: success or cancellation/failure outcome.

The renderer writes full-canvas GIF frames so Markdown/browser viewers do not crop frames differently during playback. It does not use Playwright, Chrome, Edge, or Mermaid CLI; it renders this sequence-diagram subset directly to SVG and rasterizes with `sharp`.
