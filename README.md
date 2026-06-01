# Bus SG App

A lightweight bus transport web app that uses the gateway OpenAPI contract at:

- http://localhost:8067/openapi.json

The frontend is built with SvelteKit. It dynamically loads transport endpoints from the OpenAPI spec and calls them through a SvelteKit server hook proxy.

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

## Features

- Dynamic endpoint explorer built from OpenAPI paths under /api/v1/*
- Bus-focused endpoint filtering (Bus and Passenger Volume tags)
- Quick bus-arrival panel with BusStopCode and optional ServiceNo
- JSON response viewer
- Arrival board card view when the response includes Services
- Server-side proxying for `/api/*` and `/openapi.json`

## Config

Environment variables:

- `PORT` (default: `3000`)
- `API_ORIGIN` (default: `http://localhost:8067`)

Example:

```bash
API_ORIGIN=http://localhost:8067 PORT=3001 bun run dev -- --port 3001
```
