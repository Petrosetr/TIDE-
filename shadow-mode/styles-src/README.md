# Shadow Mode CSS Sources

`shadow-mode/styles.css` is now generated, but the real app pages load page-specific bundles (`styles-workspace.css`, `styles-results.css`, `styles-live.css`, `styles-setup.css`).

Edit the source files in this folder, then run:

```bash
npm run build:styles
```

Current split:

- `00-foundation-shell.css` - tokens, resets, app shell, shared components, early page layout
- `10-results-workspace.css` - results and workspace era blocks before live/create took over the tail
- `20-live.css` - live-only execution and route surfaces
- `30-scenario-chart.css` - shared scenario chart / corridor plane surfaces used outside Setup
- `90-runtime-polish.css` - small shared runtime polish layer for focus rings, chart tokens, and cross-page fixes
- `98-setup-rebuild.css` - setup-only shell + component layer; owns the compact Create composer, wallet pill, chart-plane polish, responsive layout, and sticky footer

Rules:

1. `styles-setup.css` is clean on purpose: it now ships only `00 + 98`. Do not re-add non-setup layers to setup.
2. Treat `98-setup-rebuild.css` as the source of truth for setup shell and setup components.
3. Keep setup selectors out of `10`, `20`, `30`, and `90`. Setup should stay isolated inside `98`.
4. If a setup fix needs a selector from another layer, port the minimal rule into `98` instead of reviving a cross-page dependency.
5. Use `npm run audit:styles` before deleting selectors; it reports suspects, not guaranteed dead code.
6. `styles.css` is now only a minimal compatibility fallback, not a source of truth for any page.
7. Keep generated CSS checked in so the static deploy stays trivial.
