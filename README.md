# Weapon Grid Lab

A device-local browser tool for testing growing weapon grids, multi-cell items,
growth-weight modifiers, and geometry-driven structure bonuses.

## Start the lab

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Then open `http://localhost:3000/`. The port is fixed so the browser always
uses the same IndexedDB storage origin.

## Saving and backups

- The active workspace autosaves to IndexedDB in the current browser.
- **Request persistence** asks the browser to protect the local data from
  automatic storage cleanup.
- **Export** creates a `.weapon-grid.json` backup containing grids, items, and
  uploaded artwork.
- **Import** restores one of those backups.

There is no server database, account, or external service.

## Content definitions

- Built-in item definitions live in `app/content/catalog.ts`.
- Declarative structure recipes live in the same catalog and support exact item
  IDs, tags, rotations, optional reflections, stat modifiers, and ability text.
- Growth, footprint, connectivity, and pattern-matching rules live in
  `app/lib/grid.ts`.

## Useful commands

```powershell
npm run dev       # local development server
npm run build     # production build check
npm run lint      # source-quality check
npm test          # build plus unit and rendered-shell tests
```

