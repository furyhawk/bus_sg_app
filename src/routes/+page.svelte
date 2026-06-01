<script>
  import { onDestroy, onMount } from "svelte";

  let statusText = "Idle";
  let statusState = "";
  let responseText = "No request yet.";
  let services = [];

  let serviceNo = "";
  let locating = false;
  let loadingArrivals = false;

  let userLocation = null;
  let nearestStop = null;
  let locationMessage = "Allow location access to find your nearest bus stop.";

  let mapContainer;
  let map;
  let mapLayer;
  let userMarker;
  let stopMarker;
  let linkLine;

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

  async function loadAllBusStops() {
    const allStops = [];
    const pageSize = 500;
    let skip = 0;

    while (true) {
      const query = new URLSearchParams({ $top: String(pageSize), $skip: String(skip) });
      const response = await fetch(`/api/v1/bus-stops?${query.toString()}`);
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

  async function resolveNearestBusStop(position) {
    const stops = await loadAllBusStops();
    let closest = null;

    stops.forEach((stop) => {
      const lat = parseCoordinate(stop.Latitude);
      const lon = parseCoordinate(stop.Longitude);
      if (lat === null || lon === null) {
        return;
      }

      const distanceMeters = haversineMeters(position.lat, position.lon, lat, lon);
      if (!closest || distanceMeters < closest.distanceMeters) {
        closest = {
          code: stop.BusStopCode,
          description: stop.Description || "Unnamed stop",
          roadName: stop.RoadName || "",
          lat,
          lon,
          distanceMeters
        };
      }
    });

    if (!closest) {
      throw new Error("No valid bus stop coordinates were returned.");
    }

    return closest;
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

  async function updateMap() {
    if (!mapContainer) {
      return;
    }

    const leaflet = await import("leaflet");

    if (!map) {
      map = leaflet.map(mapContainer, {
        zoomControl: true,
        scrollWheelZoom: true
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

    if (nearestStop) {
      const stopLatLng = [nearestStop.lat, nearestStop.lon];
      const stopLabel = `${nearestStop.description} (${nearestStop.code})`;
      if (!stopMarker) {
        stopMarker = leaflet.marker(stopLatLng, { title: stopLabel }).addTo(map);
      } else {
        stopMarker.setLatLng(stopLatLng);
      }
      stopMarker.bindPopup(stopLabel);
    }

    if (userLocation && nearestStop) {
      const linePoints = [
        [userLocation.lat, userLocation.lon],
        [nearestStop.lat, nearestStop.lon]
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

    const url = `/api/v1/bus-arrival?${query.toString()}`;
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
  }

  async function runArrival() {
    if (!nearestStop) {
      await resolveLocationAndNearestStop(false);
      if (!nearestStop) {
        return;
      }
    }

    loadingArrivals = true;
    try {
      await callArrivalEndpoint(nearestStop.code);
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
    } finally {
      loadingArrivals = false;
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

      locationMessage = "Finding nearest bus stop...";
      nearestStop = await resolveNearestBusStop(userLocation);
      locationMessage = `Nearest stop: ${nearestStop.description} (${nearestStop.code})`;

      await updateMap();
      setStatus("Location Ready", "ok");

      if (loadArrivals) {
        await runArrival();
      }
    } catch (error) {
      locationMessage = error?.message || "Unable to resolve current location.";
      setStatus("Location Error", "error");
    } finally {
      locating = false;
    }
  }

  onMount(async () => {
    await updateMap();
    await resolveLocationAndNearestStop();
  });

  onDestroy(() => {
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

<div class="bg-grid"></div>
<main class="app-shell">
  <header class="hero">
    <p class="kicker">Singapore Transit</p>
    <h1>Nearby Bus Arrivals</h1>
    <p class="subtitle">Map-driven view using your current location to detect the nearest bus stop.</p>
  </header>

  <section class="panel">
    <div class="panel-header compact">
      <div>
        <h2>Live Map</h2>
        <p class="hint">{locationMessage}</p>
      </div>
      <button class="btn-ghost" type="button" on:click={() => resolveLocationAndNearestStop()} disabled={locating}>
        {locating ? "Locating..." : "Use Current Location"}
      </button>
    </div>

    <div class="map-panel" bind:this={mapContainer}></div>

    <div class="stop-meta">
      <div class="meta-item">
        <span class="meta-label">Nearest stop</span>
        <strong>{nearestStop ? `${nearestStop.code} - ${nearestStop.description}` : "Not resolved"}</strong>
      </div>
      <div class="meta-item">
        <span class="meta-label">Road</span>
        <strong>{nearestStop?.roadName || "-"}</strong>
      </div>
      <div class="meta-item">
        <span class="meta-label">Distance</span>
        <strong>{nearestStop ? formatDistance(nearestStop.distanceMeters) : "-"}</strong>
      </div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-header compact">
      <h2>Arrivals</h2>
      <span class={`status-pill ${statusState}`}>{statusText}</span>
    </div>

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
  </section>
</main>
