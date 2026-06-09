<script>
  import { onDestroy, onMount } from "svelte";

  const RAW_API_BASE = import.meta.env.VITE_API_BASE ?? "";
  const ARRIVAL_REFRESH_MS = 30000;

  function resolveApiBase() {
    const base = RAW_API_BASE.trim().replace(/\/+$/, "");
    if (!base) {
      return "";
    }

    const platform = globalThis.Capacitor?.getPlatform?.();
    if (platform === "android") {
      return base.replace(/^http:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, "http://10.0.2.2");
    }

    return base;
  }

  const API_BASE = resolveApiBase();

  let statusText = "Idle";
  let statusState = "";
  let responseText = "No request yet.";
  let services = [];
  let arrivalsStopCode = "";

  let serviceNo = "";
  let locating = false;
  let loadingArrivals = false;
  let mobileSheetOpen = false;
  let stopsVisible = true;

  let userLocation = null;
  let selectedStop = null;
  let nearbyStops = [];
  let locationMessage = "Allow location access to find your nearest bus stop.";

  let mapContainer;
  let map;
  let mapLayer;
  let userMarker;
  let stopMarker;
  let selectedStopMarkerIcon;
  let linkLine;
  let nearbyStopMarkers = [];
  let isMapClickPicking = false;
  let arrivalRefreshTimer;

  $: mapArrivals =
    selectedStop && arrivalsStopCode === selectedStop.code
      ? services.slice(0, 4).map((service) => ({
          serviceNo: service?.ServiceNo || "?",
          next: minutesUntil(service?.NextBus?.EstimatedArrival),
          following: minutesUntil(service?.NextBus2?.EstimatedArrival)
        }))
      : [];

  $: overlayNearbyStops = nearbyStops.slice(0, 3);

  function setStatus(text, state = "") {
    statusText = text;
    statusState = state;
  }

  function parseCoordinate(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) {
      return "n/a";
    }

    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }

    return `${Math.round(meters)} m`;
  }

  function minutesUntil(isoValue) {
    if (!isoValue) {
      return "n/a";
    }

    const target = new Date(isoValue);
    if (Number.isNaN(target.getTime())) {
      return "n/a";
    }

    const deltaMs = target.getTime() - Date.now();
    const mins = Math.max(0, Math.round(deltaMs / 60000));
    return `${mins} min`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildStopPopup(stop) {
    const title = `${stop.description} (${stop.code})`;
    if (arrivalsStopCode !== stop.code || services.length === 0) {
      return `<strong>${escapeHtml(title)}</strong>`;
    }

    const topServices = services.slice(0, 3);
    const lines = topServices
      .map((service) => {
        const serviceCode = service?.ServiceNo || "?";
        const eta = minutesUntil(service?.NextBus?.EstimatedArrival);
        return `<li>${escapeHtml(serviceCode)}: ${escapeHtml(eta)}</li>`;
      })
      .join("");

    return `<div><strong>${escapeHtml(title)}</strong><br /><small>Live arrivals</small><ul style=\"margin:.35rem 0 0 1rem;padding:0\">${lines}</ul></div>`;
  }

  async function loadAllBusStops() {
    const allStops = [];
    const pageSize = 500;
    let skip = 0;

    while (true) {
      const query = new URLSearchParams({ $top: String(pageSize), $skip: String(skip) });
      const response = await fetch(`${API_BASE}/api/v1/bus-stops?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Unable to load bus stops (${response.status})`);
      }

      const payload = await response.json();
      let chunk = [];
      if (Array.isArray(payload?.value)) {
        chunk = payload.value;
      } else if (Array.isArray(payload?.items)) {
        chunk = payload.items;
      } else if (Array.isArray(payload)) {
        chunk = payload;
      }

      allStops.push(...chunk);

      if (chunk.length < pageSize || skip > 15000) {
        break;
      }

      skip += pageSize;
    }

    return allStops;
  }

  async function resolveNearbyBusStops(position, limit = 8) {
    const stops = await loadAllBusStops();
    const candidates = [];

    stops.forEach((stop) => {
      const lat = parseCoordinate(stop.Latitude);
      const lon = parseCoordinate(stop.Longitude);
      if (lat === null || lon === null) {
        return;
      }

      const distanceMeters = haversineMeters(position.lat, position.lon, lat, lon);
      candidates.push({
        code: stop.BusStopCode,
        description: stop.Description || "Unnamed stop",
        roadName: stop.RoadName || "",
        lat,
        lon,
        distanceMeters
      });
    });

    if (candidates.length === 0) {
      throw new Error("No valid bus stop coordinates were returned.");
    }

    return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);
  }

  function getBrowserPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported in this browser."));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      });
    });
  }

  function ensureMapLayer(leaflet) {
    if (mapLayer) {
      return;
    }

    mapLayer = leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    });
    mapLayer.addTo(map);
  }

  function getSelectedStopMarkerIcon(leaflet) {
    if (selectedStopMarkerIcon) {
      return selectedStopMarkerIcon;
    }

    selectedStopMarkerIcon = leaflet.icon({
      iconUrl: "/favicon.svg",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
      className: "selected-stop-marker"
    });

    return selectedStopMarkerIcon;
  }

  async function updateMap() {
    if (!mapContainer) {
      return;
    }

    const leaflet = await import("leaflet");

    if (!map) {
      map = leaflet.map(mapContainer, {
        zoomControl: false,
        scrollWheelZoom: true
      });

      leaflet.control.zoom({ position: "bottomleft" }).addTo(map);

      map.on("click", async (event) => {
        if (isMapClickPicking) {
          return;
        }

        isMapClickPicking = true;
        locating = true;
        locationMessage = "Map point selected. Finding nearby bus stops...";

        try {
          userLocation = {
            lat: event.latlng.lat,
            lon: event.latlng.lng
          };
          await resolveNearbyFromCurrentPoint(true);
        } finally {
          locating = false;
          isMapClickPicking = false;
        }
      });
    }

    ensureMapLayer(leaflet);

    if (userLocation) {
      const userLatLng = [userLocation.lat, userLocation.lon];
      if (!userMarker) {
        userMarker = leaflet.marker(userLatLng, { title: "Your location" }).addTo(map);
      } else {
        userMarker.setLatLng(userLatLng);
      }
      userMarker.bindPopup("You are here");
    }

    if (selectedStop) {
      const stopLatLng = [selectedStop.lat, selectedStop.lon];
      const stopLabel = `${selectedStop.description} (${selectedStop.code})`;
      if (!stopMarker) {
        stopMarker = leaflet
          .marker(stopLatLng, {
            title: stopLabel,
            icon: getSelectedStopMarkerIcon(leaflet)
          })
          .addTo(map);
      } else {
        stopMarker.setLatLng(stopLatLng);
        stopMarker.setIcon(getSelectedStopMarkerIcon(leaflet));
      }
      stopMarker.bindPopup(buildStopPopup(selectedStop));
    }

    nearbyStopMarkers.forEach((marker) => marker.remove());
    nearbyStopMarkers = [];

    nearbyStops.forEach((stop) => {
      const marker = leaflet
        .circleMarker([stop.lat, stop.lon], {
          radius: selectedStop?.code === stop.code ? 8 : 5,
          color: selectedStop?.code === stop.code ? "#d25f1f" : "#7f6a52",
          fillColor: selectedStop?.code === stop.code ? "#d25f1f" : "#cbbca2",
          fillOpacity: 0.85,
          weight: 2
        })
        .addTo(map);

      marker.bindPopup(buildStopPopup(stop));
      marker.on("click", () => {
        selectBusStop(stop, true);
      });
      nearbyStopMarkers.push(marker);
    });

    if (userLocation && selectedStop) {
      const linePoints = [
        [userLocation.lat, userLocation.lon],
        [selectedStop.lat, selectedStop.lon]
      ];

      if (!linkLine) {
        linkLine = leaflet.polyline(linePoints, { color: "#d25f1f", weight: 3, dashArray: "6 8" }).addTo(map);
      } else {
        linkLine.setLatLngs(linePoints);
      }

      const bounds = leaflet.latLngBounds(linePoints);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
      return;
    }

    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lon], 16);
      return;
    }

    map.setView([1.3521, 103.8198], 11);
  }

  async function callArrivalEndpoint(busStopCode) {
    const query = new URLSearchParams();
    query.append("BusStopCode", busStopCode);
    if (serviceNo.trim()) {
      query.append("ServiceNo", serviceNo.trim());
    }

    setStatus("Loading", "");
    responseText = "Loading...";

    const url = `${API_BASE}/api/v1/bus-arrival?${query.toString()}`;
    const response = await fetch(url);
    const text = await response.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    responseText = JSON.stringify(payload, null, 2);
    services = Array.isArray(payload?.Services) ? payload.Services.slice(0, 12) : [];

    if (!response.ok) {
      throw new Error(`Arrival request failed (${response.status})`);
    }

    arrivalsStopCode = busStopCode;
  }

  async function runArrival() {
    if (!selectedStop) {
      await resolveLocationAndNearestStop(false);
      if (!selectedStop) {
        return;
      }
    }

    loadingArrivals = true;
    try {
      await callArrivalEndpoint(selectedStop.code);
      setStatus("Arrivals Loaded", "ok");
    } catch (error) {
      setStatus("Arrival Error", "error");
      responseText = JSON.stringify(
        {
          error: "Request failed",
          message: error?.message || "Unknown error"
        },
        null,
        2
      );
      services = [];
      arrivalsStopCode = "";
    } finally {
      loadingArrivals = false;
      await updateMap();
    }
  }

  async function refreshArrivalsIfReady() {
    if (!selectedStop || loadingArrivals || locating) {
      return;
    }

    await runArrival();
  }

  async function selectBusStop(stop, loadArrivals = false) {
    selectedStop = stop;
    locationMessage = `Selected stop: ${stop.description} (${stop.code})`;
    await updateMap();
    if (loadArrivals) {
      await runArrival();
    }
  }

  async function resolveNearbyFromCurrentPoint(loadArrivals = true) {
    nearbyStops = await resolveNearbyBusStops(userLocation);
    selectedStop = nearbyStops[0] || null;
    if (!selectedStop) {
      throw new Error("No nearby bus stop found.");
    }

    locationMessage = `Nearest stop found: ${selectedStop.description} (${selectedStop.code}). Tap another stop in the list or map.`;
    await updateMap();
    setStatus("Location Ready", "ok");

    if (loadArrivals) {
      await runArrival();
    }
  }

  async function resolveLocationAndNearestStop(loadArrivals = true) {
    locating = true;
    locationMessage = "Resolving your location...";

    try {
      const position = await getBrowserPosition();
      userLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };

      locationMessage = "Finding nearby bus stops...";
      await resolveNearbyFromCurrentPoint(loadArrivals);
    } catch (error) {
      locationMessage = error?.message || "Unable to resolve current location.";
      setStatus("Location Error", "error");
    } finally {
      locating = false;
    }
  }

  onMount(async () => {
    arrivalRefreshTimer = setInterval(() => {
      refreshArrivalsIfReady();
    }, ARRIVAL_REFRESH_MS);

    await updateMap();
    await resolveLocationAndNearestStop();
  });

  onDestroy(() => {
    clearInterval(arrivalRefreshTimer);

    if (map) {
      map.remove();
      map = null;
    }
  });
</script>

<svelte:head>
  <title>Bus SG Nearby Arrivals</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
</svelte:head>

<div class="map-wrap">
  <div class="map-panel" bind:this={mapContainer}></div>
</div>

<main class="app-shell">
  <div class="sidebar-left">
    <header class="hero">
      <div class="hero-title-row">
        <h1>Nearby Bus Arrivals</h1>
        <p class="kicker">Singapore Transit</p>
      </div>
      <p class="subtitle">Map-first view using your location and taps to find nearby stops and live arrivals.</p>
    </header>

    <section class="panel controls-panel">
      <div class="panel-header compact">
        <div>
          <div class="location-head">
            <button
              class="btn-ghost icon-btn"
              type="button"
              aria-label={locating ? "Resolving current location" : "Use current location"}
              title={locating ? "Locating" : "Use Current Location"}
              on:click={() => resolveLocationAndNearestStop()}
              disabled={locating}
            >
              {#if locating}
                <svg class="spin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
                  <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                  <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.8" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              {/if}
              <span class="visually-hidden">{locating ? "Locating..." : "Use Current Location"}</span>
            </button>
            <p class="hint">{locationMessage}</p>
          </div>
        </div>
      </div>

      <div class="stop-meta compact">
        <div class="meta-item">
          <span class="meta-label">Stop</span>
          <strong>{selectedStop ? selectedStop.code : "-"}</strong>
        </div>
        <div class="meta-item">
          <span class="meta-label">Road</span>
          <strong>{selectedStop?.roadName || "-"}</strong>
        </div>
        <div class="meta-item">
          <span class="meta-label">Dist</span>
          <strong>{selectedStop ? formatDistance(selectedStop.distanceMeters) : "-"}</strong>
        </div>
      </div>
    </section>

    <section class="panel nearby-panel" class:collapsed={!stopsVisible} aria-hidden={!stopsVisible}>
      <div class="nearby-header">
        <p class="meta-label">Nearby stops</p>
        <button
          class="toggle-btn"
          type="button"
          aria-label={stopsVisible ? "Hide nearby stops" : "Show nearby stops"}
          on:click={() => (stopsVisible = !stopsVisible)}
        >
          {stopsVisible ? "Hide" : "Show"}
        </button>
      </div>

      {#if stopsVisible}
        {#if nearbyStops.length > 0}
          <div class="nearby-list">
            {#each nearbyStops as stop}
              <button
                class={`stop-choice ${selectedStop?.code === stop.code ? "active" : ""}`}
                type="button"
                on:click={() => selectBusStop(stop, true)}
              >
                <span>{stop.code} - {stop.description}</span>
                <small>{formatDistance(stop.distanceMeters)}</small>
              </button>
            {/each}
          </div>
        {:else}
          <p class="hint">No nearby stops loaded yet.</p>
        {/if}
      {/if}
    </section>
  </div>

  <aside class="map-arrivals-overlay" aria-live="polite">
    <h3>Arrivals</h3>
    <p class="map-overlay-stop">
      {#if selectedStop}
        {selectedStop.code} - {selectedStop.description}
      {:else}
        No stop selected
      {/if}
    </p>

    {#if loadingArrivals}
      <p class="map-overlay-empty">Loading arrivals...</p>
    {:else if mapArrivals.length > 0}
      <ul class="map-arrivals-list">
        {#each mapArrivals as item}
          <li>
            <strong>{item.serviceNo}</strong>
            <span>{item.next}</span>
            <small>Then {item.following}</small>
          </li>
        {/each}
      </ul>
    {:else if overlayNearbyStops.length > 0}
      <p class="map-overlay-empty">Nearby stops</p>
      <ul class="map-overlay-fallback-list">
        {#each overlayNearbyStops as stop}
          <li>
            <strong>{stop.code}</strong>
            <span>{formatDistance(stop.distanceMeters)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="map-overlay-empty">Waiting for location to load stops...</p>
    {/if}
  </aside>

  <section class="panel arrivals-panel" class:sheet-collapsed={!mobileSheetOpen}>
    <button
      class="sheet-grabber"
      type="button"
      aria-label={mobileSheetOpen ? "Collapse arrivals panel" : "Expand arrivals panel"}
      aria-expanded={mobileSheetOpen}
      on:click={() => (mobileSheetOpen = !mobileSheetOpen)}
    >
      <span></span>
    </button>

    <div class="panel-header compact">
      <h2>Arrivals</h2>
      <div class="arrivals-head-actions">
        <span class={`status-pill ${statusState}`}>{statusText}</span>
        <button class="mobile-sheet-toggle" type="button" on:click={() => (mobileSheetOpen = !mobileSheetOpen)}>
          {mobileSheetOpen ? "Hide" : "Show"}
        </button>
      </div>
    </div>

    <div class="sheet-content" aria-hidden={!mobileSheetOpen}>
      <div class="arrivals-actions">
        <label>
          Service filter (optional)
          <input bind:value={serviceNo} placeholder="e.g. 14" />
        </label>
        <button class="btn-accent" type="button" on:click={runArrival} disabled={loadingArrivals || locating}>
          {loadingArrivals ? "Loading..." : "Refresh Arrivals"}
        </button>
      </div>

      {#if services.length > 0}
        <div class="arrival-board">
          {#each services as service}
            <article class="arrival-card">
              <h3>Service {service.ServiceNo || "?"}</h3>
              <p class="arrival-line">Next: {minutesUntil(service?.NextBus?.EstimatedArrival)}</p>
              <p class="arrival-line">Following: {minutesUntil(service?.NextBus2?.EstimatedArrival)}</p>
              <p class="arrival-line">Third: {minutesUntil(service?.NextBus3?.EstimatedArrival)}</p>
            </article>
          {/each}
        </div>
      {:else}
        <p class="hint">No arrivals loaded yet. Tap "Use Current Location" then "Refresh Arrivals".</p>
      {/if}

      <details class="raw-response">
        <summary>Raw response</summary>
        <pre class="response">{responseText}</pre>
      </details>
    </div>
  </section>
</main>
