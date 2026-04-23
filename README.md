# Nelson Arrangements

Portfolio website for Garrett Nelson's original hymn arrangements for piano and organ.

## Tech Stack

- **Vite** — build tool and dev server
- **Vanilla HTML/CSS/JS** — no frontend framework
- **Custom HTML partials plugin** — resolves `<!-- include: path -->` comments at build time (see `vite.config.js`)

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with HMR |
| `npm run build` | Build for production → `dist/` |
| `npm run preview` | Preview the production build locally |

## Project Structure

```
Website 3.0/
├── partials/            # Shared HTML fragments
│   ├── _head.html
│   ├── _nav.html
│   ├── _footer.html
│   └── _newsletter-modal.html
├── src/
│   ├── css/             # Stylesheets
│   └── js/              # Scripts
├── public/              # Static assets (copied as-is to dist/)
├── index.html           # Home
├── about.html
├── arrangements.html
├── sheet-music.html
├── learn.html
├── registration-basics.html
├── creative-hymn-playing.html
├── its-not-a-piano.html
├── pistonlink.html
└── vite.config.js
```

## HTML Partials

Shared markup is stored in `partials/` and included via a comment directive:

```html
<!-- include: partials/_nav.html -->
```

The custom Vite plugin (`htmlPartialsPlugin` in `vite.config.js`) resolves these recursively during both dev and build.
