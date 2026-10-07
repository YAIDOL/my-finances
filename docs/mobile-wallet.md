# Wallet and mobile presentation — 2026-10-07

Cash accounts use a separate shared `CashAccount` presentation in Accounts and the Home carousel, with a 3D leather wallet, balance, name and cash label. They have no bank-card chip, number or stacked-card decoration. Account color tints remain visible. The brand, Home illustration and Auth illustration use the same wallet asset.

The phone layout adds a five-position bottom navigation (Home, Accounts, Add operation, Transactions, More), safe-area spacing, a compact hero, larger form fields and touch targets, and wrapping ledger/payment rows. The extra menu sits above the dock; native modal dialogs remain in the top layer. Theme, hidden amounts and reduced-motion preferences continue to apply.

## Image asset

- Generated with the built-in image generator; no external API credentials or new dependencies.
- Prompt: “A single closed dark graphite leather bifold wallet with rounded edges, visibly thick layered leather, neat stitched seam and a short leather strap with brushed silver snap button. Three-quarter view. Elegant realistic 3D studio rendering, soft cool highlights, restrained charcoal and steel palette. Centered isolated object on a genuinely transparent background. No bank cards, chip, coins, banknotes, text, logo or platform.”
- Original preserved in ignored `output/imagegen/wallet-3d-source.png` (1254 × 1254, alpha 0–255).
- Production asset: `public/assets/wallet-3d.webp`, 640 × 640, 93,758 bytes. Resized and encoded locally with Pillow; transparency preserved.

## Verification

- TypeScript build and all 113 existing tests passed.
- Browser checks used isolated local demo data; no user financial records were changed.
- At 320 px, all nine app pages were inspected for horizontal overflow. A budget grid overflow and a Home glow overflow were found and corrected.
- Checked additional phone, tablet and desktop widths, light/dark themes, hidden amounts and reduced motion.
- Exercised account creation, cash carousel presentation, bottom navigation, extra sections and the operation modal; cash method still offers only cash accounts.

These are layout and interaction checks, not a claim of exhaustive device coverage.
