# Bus SG App

A lightweight bus transport web app that uses the gateway OpenAPI contract at:

- http://localhost:8067/openapi.json

The frontend dynamically loads transport endpoints from the OpenAPI spec and calls them through a local proxy server.

## Run

1. Ensure your API gateway is running at http://localhost:8067.
2. Start this app:

```bash
bun run start
```

3. Open:

- http://localhost:3000

## Features

- Dynamic endpoint explorer built from OpenAPI paths under /api/v1/*
- Bus-focused endpoint filtering (Bus and Passenger Volume tags)
- Quick bus-arrival panel with BusStopCode and optional ServiceNo
- JSON response viewer
- Arrival board card view when the response includes Services

## Config

Environment variables:

- `PORT` (default: `3000`)
- `API_ORIGIN` (default: `http://localhost:8067`)

Example:

```bash
API_ORIGIN=http://localhost:8067 PORT=3001 bun run start
```
