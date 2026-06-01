<script>
  import { onMount } from "svelte";

  const fallbackEndpointOptions = [
    { label: "Bus Arrivals", path: "/api/v1/bus-arrival", method: "GET" },
    { label: "Bus Services", path: "/api/v1/bus-services", method: "GET" },
    { label: "Bus Routes", path: "/api/v1/bus-routes", method: "GET" },
    { label: "Bus Stops", path: "/api/v1/bus-stops", method: "GET" },
    { label: "Planned Bus Routes", path: "/api/v1/planned-bus-routes", method: "GET" },
    { label: "Passenger Volume (Bus)", path: "/api/v1/passenger-volume/bus", method: "GET" },
    {
      label: "Passenger Volume (OD Bus)",
      path: "/api/v1/passenger-volume/od-bus",
      method: "GET"
    }
  ];

  let endpointOptions = [...fallbackEndpointOptions];
  let selectedEndpointIndex = 0;
  let method = "GET";
  let params = [];
  let responseText = "No request yet.";
  let statusText = "Idle";
  let statusState = "";
  let services = [];

  let serviceNo = "";
  let userLocation = null;
  let nearestStop = null;
  let locating = false;
  let locationMessage = "Location not resolved yet.";
  let mapContainer;
  let map;
  let mapLayer;
  let userMarker;
  let stopMarker;

  function getSelectedEndpoint() {
    return endpointOptions[selectedEndpointIndex] || endpointOptions[0];
  }

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

  function titleizePath(path) {
    return path
      .replace("/api/v1/", "")
      .split("/")
      .map((part) => part.replace(/-/g, " "))
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" - ");
  }

  async function loadOpenApiEndpoints() {
    try {
      const response = await fetch("/openapi.json");
      if (!response.ok) {
        return;
      }

      const spec = await response.json();
      const paths = spec && spec.paths ? spec.paths : {};
      const discovered = [];

      Object.entries(paths).forEach(([path, methods]) => {
        if (!path.startsWith("/api/v1/")) {
          return;
        }

        const getMethod = methods && methods.get;
        if (!getMethod) {
          return;
        }

        const tags = Array.isArray(getMethod.tags) ? getMethod.tags.join(" ").toLowerCase() : "";
        const include = tags.includes("bus") || tags.includes("passenger") || path.includes("bus");
        if (!include) {
          return;
        }

        discovered.push({
          label: getMethod.summary || titleizePath(path),
          path,
          method: "GET"
        });
      });

      if (discovered.length > 0) {
        endpointOptions = discovered.sort((a, b) => a.path.localeCompare(b.path));
      }
    } catch {
      // Keep fallback endpoint options when OpenAPI loading fails.
    }
  }

  async function loadAllBusStops() {
    const allStops = [];
    const pageSize = 500;
    let skip = 0;

    while (true) {
      const search = new URLSearchParams({ $top: String(pageSize), $skip: String(skip) });
      const response = await fetch(`/api/v1/bus-stops?${search.toString()}`);
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

      if (chunk.length < pageSize) {
        break;
      }

      skip += pageSize;
      if (skip > 15000) {
        break;
      }
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
      const label = `${nearestStop.description} (${nearestStop.code})`;
      if (!stopMarker) {
        stopMarker = leaflet.marker(stopLatLng, { title: label }).addTo(map);
      } else {
        stopMarker.setLatLng(stopLatLng);
      }
      stopMarker.bindPopup(label);
    }

    if (userLocation && nearestStop) {
      const bounds = leaflet.latLngBounds(
        [userLocation.lat, userLocation.lon],
        [nearestStop.lat, nearestStop.lon]
      );
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
      return;
    }

    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lon], 16);
      return;
    }

    map.setView([1.3521, 103.8198], 11);
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

  async function resolveLocationAndNearestStop() {
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
      locationMessage = `Nearest stop: ${nearestStop.description} (${nearestStop.code}), ${Math.round(
        nearestStop.distanceMeters
      )}m away`;
      setStatus("Location Ready", "ok");
      await updateMap();
    } catch (error) {
      const message = error?.message || "Unable to resolve current location.";
      locationMessage = message;
      setStatus("Location Error", "error");
    } finally {
      locating = false;
    }
  }

  function seedDefaultParams() {
    const selected = getSelectedEndpoint();

    if (selected.path === "/api/v1/bus-arrival") {
      params = [
        { key: "BusStopCode", value: "83139" },
        { key: "ServiceNo", value: "" }
      ];
      return;
    }

    params = [
      { key: "$skip", value: "0" },
      { key: "$top", value: "10" }
    ];
  }

  function addParamRow() {
    params = [...params, { key: "", value: "" }];
  }

  function removeParamRow(index) {
    params = params.filter((_, i) => i !== index);
  }

  function updateParam(index, field, value) {
    params = params.map((param, i) => {
      if (i !== index) {
        return param;
      }

      return { ...param, [field]: value };
    });
  }

  function collectParams() {
    const search = new URLSearchParams();

    params.forEach((param) => {
      const key = param.key.trim();
      const value = param.value.trim();
      if (key) {
        search.append(key, value);
      }
    });

    return search;
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

  async function callEndpoint(path, queryParams) {
    const query = queryParams.toString();
    const url = query ? `${path}?${query}` : path;

    setStatus("Loading");
    responseText = "Loading...";

    try {
      const response = await fetch(url);
      const text = await response.text();

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }

      responseText = JSON.stringify(payload, null, 2);
      if (response.ok) {
        setStatus(`OK ${response.status}`, "ok");
      } else {
        setStatus(`Error ${response.status}`, "error");
      }

      services = Array.isArray(payload?.Services) ? payload.Services.slice(0, 12) : [];
    } catch (error) {
      responseText = JSON.stringify(
        {
          error: "Request failed",
          message: error?.message || "Unknown error"
        },
        null,
        2
      );
      setStatus("Network Error", "error");
      services = [];
    }
  }

  async function runRequest() {
    const selected = getSelectedEndpoint();
    await callEndpoint(selected.path, collectParams());
  }

  async function runArrival() {
    if (!nearestStop) {
      await resolveLocationAndNearestStop();
      if (!nearestStop) {
        responseText = JSON.stringify({ error: "Unable to resolve nearest bus stop." }, null, 2);
        return;
      }
    }

    const search = new URLSearchParams();
    search.append("BusStopCode", nearestStop.code);
    if (serviceNo.trim()) {
      search.append("ServiceNo", serviceNo.trim());
    }

    await callEndpoint("/api/v1/bus-arrival", search);
  }

  function onEndpointChange() {
    method = getSelectedEndpoint().method;
    seedDefaultParams();
  }

  onMount(async () => {
    await loadOpenApiEndpoints();
    selectedEndpointIndex = 0;
    method = getSelectedEndpoint().method;
    seedDefaultParams();
    await updateMap();
    await resolveLocationAndNearestStop();
  });
</script>

<svelte:head>
  <title>Bus SG Control Deck</title>
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
    <h1>Bus Control Deck</h1>
    <p class="subtitle">
      Live explorer for the bus gateway API at
      <span>localhost:8067</span>.
    </p>
  </header>

  <section class="panel query-panel">
    <div class="panel-header">
      <h2>Endpoint Explorer</h2>
      <button class="btn-accent" type="button" on:click={runRequest}>Run Request</button>
    </div>

    <div class="grid-two">
      <label>
        Endpoint
        <select bind:value={selectedEndpointIndex} on:change={onEndpointChange}>
          {#each endpointOptions as item, index}
            <option value={index}>{item.label} ({item.path})</option>
          {/each}
        </select>
      </label>
      <label>
        Request Method
        <input value={method} readonly />
      </label>
    </div>

    <div class="params-head">
      <h3>Query Params</h3>
      <button class="btn-ghost" type="button" on:click={addParamRow}>Add Param</button>
    </div>

    <div class="params-list">
      {#each params as param, index}
        <div class="param-row">
          <input
            class="param-key"
            placeholder="Key"
            value={param.key}
            on:input={(event) => updateParam(index, "key", event.currentTarget.value)}
          />
          <input
            class="param-value"
            placeholder="Value"
            value={param.value}
            on:input={(event) => updateParam(index, "value", event.currentTarget.value)}
          />
          <button class="remove-param" type="button" on:click={() => removeParamRow(index)}>
            Remove
          </button>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel quick-panel">
    <div class="panel-header">
      <h2>Quick Arrival Check</h2>
      <button class="btn-accent" type="button" on:click={runArrival}>Get Arrivals</button>
    </div>

    <div class="location-head">
      <p class="hint">{locationMessage}</p>
      <button class="btn-ghost" type="button" on:click={resolveLocationAndNearestStop} disabled={locating}>
        {locating ? "Locating..." : "Refresh Location"}
      </button>
    </div>

    <div class="map-panel" bind:this={mapContainer}></div>

    <div class="grid-two">
      <label>
        Resolved Bus Stop
        <input value={nearestStop ? `${nearestStop.code} - ${nearestStop.description}` : "Not resolved"} readonly />
      </label>
      <label>
        Service No (optional)
        <input bind:value={serviceNo} placeholder="e.g. 14" />
      </label>
    </div>
    <p class="hint">Uses /api/v1/bus-arrival with DataMall-style query parameters.</p>
  </section>

  <section class="panel">
    <div class="panel-header">
      <h2>Response</h2>
      <span class={`status-pill ${statusState}`}>{statusText}</span>
    </div>

    <div class={`arrival-board ${services.length > 0 ? "" : "hidden"}`}>
      {#each services as service}
        <article class="arrival-card">
          <h4>Service {service.ServiceNo || "?"}</h4>
          <p class="arrival-line">Next: {minutesUntil(service?.NextBus?.EstimatedArrival)}</p>
          <p class="arrival-line">Following: {minutesUntil(service?.NextBus2?.EstimatedArrival)}</p>
        </article>
      {/each}
    </div>

    <pre class="response">{responseText}</pre>
  </section>
</main>
