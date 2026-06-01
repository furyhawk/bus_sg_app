# Bus SG App

A lightweight bus transport web app that uses the gateway OpenAPI contract at:

- http://localhost:8067/openapi.json

The frontend is built with SvelteKit. It dynamically loads transport endpoints from the OpenAPI spec and calls them through a SvelteKit server hook proxy.

## Stack

- SvelteKit + Vite + Svelte 5
- Bun for package management and scripts

## Run

1. Ensure your API gateway is running at http://localhost:8067.
2. Install dependencies:

```bash
bun install
```

3. Start this app in development:

```bash
bun run dev
```

4. Open:

- http://localhost:3000

## Build and preview

```bash
bun run build
bun run preview
```

You can also use `bun run start` to run preview mode.

## Screenshot

![Nearby Bus Arrivals UI](docs/screenshots/bus-ui.jpeg)

## Project structure

```text
src/
	app.css
	app.html
	hooks.server.js
	routes/
		+layout.svelte
		+page.svelte
svelte.config.js
vite.config.js
package.json
```

## Features

- Dynamic endpoint explorer built from OpenAPI paths under /api/v1/*
- Bus-focused endpoint filtering (Bus and Passenger Volume tags)
- Quick bus-arrival panel that uses your current location to resolve the nearest bus stop automatically
- Map view for current location and nearest resolved bus stop
- Optional ServiceNo filter for arrival checks
- JSON response viewer
- Arrival board card view when the response includes Services
- Server-side proxying for `/api/*` and `/openapi.json`

## Config

Environment variables:

- `API_ORIGIN` (default: `http://localhost:8067`)

Example:

```bash
API_ORIGIN=http://localhost:8067 bun run dev -- --port 3001
```

## Cleanup note

Legacy files from the earlier custom Node static server version were removed.
