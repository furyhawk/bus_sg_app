const fallbackEndpointOptions = [
  { label: "Bus Arrivals", path: "/api/v1/bus-arrival", method: "GET" },
  { label: "Bus Services", path: "/api/v1/bus-services", method: "GET" },
  { label: "Bus Routes", path: "/api/v1/bus-routes", method: "GET" },
  { label: "Bus Stops", path: "/api/v1/bus-stops", method: "GET" },
  { label: "Planned Bus Routes", path: "/api/v1/planned-bus-routes", method: "GET" },
  { label: "Passenger Volume (Bus)", path: "/api/v1/passenger-volume/bus", method: "GET" },
  { label: "Passenger Volume (OD Bus)", path: "/api/v1/passenger-volume/od-bus", method: "GET" }
];

let endpointOptions = [...fallbackEndpointOptions];

const endpointEl = document.querySelector("#endpoint");
const methodEl = document.querySelector("#method");
const paramsEl = document.querySelector("#params");
const responseEl = document.querySelector("#response");
const statusPillEl = document.querySelector("#status-pill");
const arrivalBoardEl = document.querySelector("#arrival-board");

const addParamBtn = document.querySelector("#add-param");
const sendRequestBtn = document.querySelector("#send-request");
const runArrivalBtn = document.querySelector("#run-arrival");

const busStopCodeEl = document.querySelector("#bus-stop-code");
const serviceNoEl = document.querySelector("#service-no");

function setStatus(text, state) {
  statusPillEl.textContent = text;
  statusPillEl.classList.remove("ok", "error");
  if (state) {
    statusPillEl.classList.add(state);
  }
}

function addParamRow(key = "", value = "") {
  const template = document.querySelector("#param-template");
  const row = template.content.firstElementChild.cloneNode(true);

  const keyEl = row.querySelector(".param-key");
  const valueEl = row.querySelector(".param-value");
  const removeBtn = row.querySelector(".remove-param");

  keyEl.value = key;
  valueEl.value = value;

  removeBtn.addEventListener("click", () => row.remove());
  paramsEl.appendChild(row);
}

function getSelectedEndpoint() {
  const index = Number(endpointEl.value);
  return endpointOptions[index] || endpointOptions[0];
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

function collectParams() {
  const rows = [...paramsEl.querySelectorAll(".param-row")];
  const params = new URLSearchParams();

  rows.forEach((row) => {
    const key = row.querySelector(".param-key").value.trim();
    const value = row.querySelector(".param-value").value.trim();
    if (key) {
      params.append(key, value);
    }
  });

  return params;
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

function renderArrivalBoard(payload) {
  arrivalBoardEl.innerHTML = "";
  const services = payload && payload.Services;

  if (!Array.isArray(services) || services.length === 0) {
    arrivalBoardEl.classList.add("hidden");
    return;
  }

  services.slice(0, 12).forEach((svc) => {
    const card = document.createElement("article");
    card.className = "arrival-card";

    const title = document.createElement("h4");
    title.textContent = `Service ${svc.ServiceNo || "?"}`;

    const line1 = document.createElement("p");
    line1.className = "arrival-line";
    line1.textContent = `Next: ${minutesUntil(svc.NextBus && svc.NextBus.EstimatedArrival)}`;

    const line2 = document.createElement("p");
    line2.className = "arrival-line";
    line2.textContent = `Following: ${minutesUntil(
      svc.NextBus2 && svc.NextBus2.EstimatedArrival
    )}`;

    card.appendChild(title);
    card.appendChild(line1);
    card.appendChild(line2);
    arrivalBoardEl.appendChild(card);
  });

  arrivalBoardEl.classList.remove("hidden");
}

async function callEndpoint(path, params) {
  const query = params.toString();
  const url = query ? `${path}?${query}` : path;

  setStatus("Loading", "");
  responseEl.textContent = "Loading...";

  try {
    const response = await fetch(url);
    const text = await response.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    responseEl.textContent = JSON.stringify(payload, null, 2);
    if (response.ok) {
      setStatus(`OK ${response.status}`, "ok");
    } else {
      setStatus(`Error ${response.status}`, "error");
    }

    renderArrivalBoard(payload);
  } catch (error) {
    responseEl.textContent = JSON.stringify(
      {
        error: "Request failed",
        message: error.message
      },
      null,
      2
    );
    setStatus("Network Error", "error");
    arrivalBoardEl.classList.add("hidden");
  }
}

function seedDefaultParams() {
  paramsEl.innerHTML = "";
  const selected = getSelectedEndpoint();

  if (selected.path === "/api/v1/bus-arrival") {
    addParamRow("BusStopCode", "83139");
    addParamRow("ServiceNo", "");
    return;
  }

  addParamRow("$skip", "0");
  addParamRow("$top", "10");
}

function initEndpointOptions() {
  endpointEl.innerHTML = "";
  endpointOptions.forEach((item, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = `${item.label} (${item.path})`;
    endpointEl.appendChild(opt);
  });

  endpointEl.value = "0";
  methodEl.value = endpointOptions[0].method;
  seedDefaultParams();
}

addParamBtn.addEventListener("click", () => addParamRow());

endpointEl.addEventListener("change", () => {
  const selected = getSelectedEndpoint();
  methodEl.value = selected.method;
  seedDefaultParams();
});

sendRequestBtn.addEventListener("click", async () => {
  const selected = getSelectedEndpoint();
  const params = collectParams();
  await callEndpoint(selected.path, params);
});

runArrivalBtn.addEventListener("click", async () => {
  const params = new URLSearchParams();
  const busStopCode = busStopCodeEl.value.trim();
  const serviceNo = serviceNoEl.value.trim();

  if (!busStopCode) {
    responseEl.textContent = JSON.stringify(
      { error: "BusStopCode is required for arrival checks." },
      null,
      2
    );
    setStatus("Missing BusStopCode", "error");
    return;
  }

  params.append("BusStopCode", busStopCode);
  if (serviceNo) {
    params.append("ServiceNo", serviceNo);
  }

  await callEndpoint("/api/v1/bus-arrival", params);
});

async function init() {
  await loadOpenApiEndpoints();
  initEndpointOptions();
}

init();
