/**
 * TerraSense — Frontend Application Logic
 * Handles API calls, Leaflet maps, Chart.js rendering, and PDF export.
 */

// ─── Configuration ──────────────────────────────────────────────────────────
const API_BASE = "http://localhost:5001";

// ─── State ──────────────────────────────────────────────────────────────────
let currentData = null;
let gaugeChartInstance = null;
let barChartInstance = null;

// ─── Map State ───────────────────────────────────────────────────────────────
let leafletMap = null;
let mapMode = "pin"; // "pin" | "heat"
let pinMarkers = [];
let heatLayer = null;
let heatRegionLayer = null;
let heatRadiusLayer = null;
let heatLegendControl = null;
let heatmapRunning = false;

const HEATMAP_RADIUS_KM = 5;
const HEATMAP_STEP_KM = 1.25;

const RISK_MAP_COLORS = {
  Low: "#34d399",
  Medium: "#fbbf24",
  High: "#fb7185",
};

// ─── Map Initialisation ──────────────────────────────────────────────────────
function initMap() {
  if (leafletMap) return;

  leafletMap = L.map("leafletMap", {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: true,
  });

  // OpenStreetMap tiles — replaces the CARTO basemap
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(leafletMap);

  // Map click handler
  leafletMap.on("click", onMapClick);

  // Recalculate map dimensions after layout settles
  requestAnimationFrame(() => {
    if (leafletMap) {
      leafletMap.invalidateSize();
    }
  });
}

// ─── Map Mode Toggle ─────────────────────────────────────────────────────────
function setMapMode(mode) {
  if (mode !== "pin" && mode !== "heat") return;

  mapMode = mode;

  document
    .getElementById("btnPinMode")
    .classList.toggle("active", mode === "pin");

  document
    .getElementById("btnHeatMode")
    .classList.toggle("active", mode === "heat");

  const hint = document.getElementById("mapHint");
  const hintText = document.getElementById("mapHintText");

  if (mode === "pin") {
    hintText.textContent =
      "Click anywhere on the map to drop a pin and assess risk at that location.";

    hint.style.borderColor = "rgba(34,211,238,0.15)";
    hint.style.color = "var(--accent-cyan)";
  } else {
    hintText.textContent =
      "Heatmap mode: click a region to sample a 5km radius risk overlay.";

    hint.style.borderColor = "rgba(251,113,133,0.25)";
    hint.style.color = "var(--accent-rose)";
  }
}

// ─── Pin Mode: Drop Marker + Fetch Risk ───────────────────────────────────────
async function onMapClick(e) {
  if (mapMode !== "pin") {
    await generateHeatmap(e.latlng.lat, e.latlng.lng);
    return;
  }

  const { lat, lng } = e.latlng;

  const soil = document.getElementById("soilSelect").value;
  const vegetation = document.getElementById("vegSelect").value;

  if (!soil || !vegetation) {
    showError(
      "Please select Soil Type and Vegetation Cover before pinning a location.",
    );
    return;
  }

  hideError();

  const loadingIcon = L.divIcon({
    className: "",
    html: `
      <div style="
        width:34px;
        height:34px;
        border-radius:50%;
        background:rgba(34,211,238,0.15);
        border:2px solid #22d3ee;
        display:flex;
        align-items:center;
        justify-content:center;
        animation:spin 1s linear infinite;
        font-size:18px;
      ">⟳</div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

  const loadingMarker = L.marker([lat, lng], {
    icon: loadingIcon,
  }).addTo(leafletMap);

  try {
    const [cityLabel, assessment] = await Promise.all([
      reverseGeocode(lat, lng),
      fetchCoordinateAssessment(lat, lng, soil, vegetation),
    ]);

    const { res, data } = assessment;

    if (!res.ok) {
      leafletMap.removeLayer(loadingMarker);
      showError(data.error || "Assessment failed for pinned location.");
      return;
    }

    data.city = cityLabel;

    leafletMap.removeLayer(loadingMarker);

    await addPinnedAssessment(lat, lng, data, cityLabel);
  } catch (err) {
    leafletMap.removeLayer(loadingMarker);

    showError(
      "Cannot reach the server. Make sure the Flask backend is running on port 5001.",
    );

    console.error("Map assessment error:", err);
  }
}

// ─── Coordinate Assessment API ───────────────────────────────────────────────
async function fetchCoordinateAssessment(lat, lng, soil, vegetation) {
  const res = await fetch(`${API_BASE}/assess-coordinate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      lat,
      lon: lng,
      soil,
      vegetation,
    }),
  });

  const data = await res.json();

  return { res, data };
}

// ─── Add Pinned Assessment ───────────────────────────────────────────────────
async function addPinnedAssessment(lat, lng, data, label = data.city) {
  const displayData = {
    ...data,
    city: label,
  };

  const riskMarker = createRiskMarker(lat, lng, displayData);

  pinMarkers.push(riskMarker);

  riskMarker.openPopup();

  currentData = displayData;

  renderDashboard(displayData);

  document.getElementById("cityInput").value = label;
}

// ─── Create Risk Marker ──────────────────────────────────────────────────────
function createRiskMarker(lat, lng, data) {
  const colorMap = {
    Low: "#34d399",
    Medium: "#fbbf24",
    High: "#fb7185",
  };

  const color = colorMap[data.risk_level] || "#94a3b8";

  const icon = L.divIcon({
    className: "",
    html: `
      <div style="
        width:36px;
        height:36px;
        border-radius:50%;
        background:${color}22;
        border:2.5px solid ${color};
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:13px;
        font-weight:700;
        color:${color};
        box-shadow:0 0 12px ${color}55;
        font-family:Inter,sans-serif;
      ">${data.total_score}</div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });

  const popup = L.popup({
    maxWidth: 260,
    minWidth: 200,
  }).setContent(`
    <div class="popup-title popup-risk-${data.risk_level.toLowerCase()}">
      ${data.city}
    </div>

    <div style="
      font-size:1.1rem;
      font-weight:800;
      color:${color};
      margin-bottom:6px;
    ">
      ${data.risk_level} Risk — ${data.total_score}/100
    </div>

    <div class="popup-row">
      <span>Rainfall</span>
      <span>${data.scores.rainfall}/25</span>
    </div>

    <div class="popup-row">
      <span>Elevation</span>
      <span>${data.scores.elevation}/25</span>
    </div>

    <div class="popup-row">
      <span>Soil</span>
      <span>${data.scores.soil}/20</span>
    </div>

    <div class="popup-row">
      <span>Vegetation</span>
      <span>${data.scores.vegetation}/20</span>
    </div>

    <div class="popup-row">
      <span>Bonus</span>
      <span>${data.scores.bonus}/10</span>
    </div>

    <div style="
      margin-top:10px;
      font-size:0.75rem;
      color:#64748b;
    ">
      ${data.raw.latitude.toFixed(4)}°,
      ${data.raw.longitude.toFixed(4)}°
    </div>
  `);

  return L.marker([lat, lng], {
    icon,
  })
    .addTo(leafletMap)
    .bindPopup(popup);
}

// ─── Build Heatmap Sample Points ─────────────────────────────────────────────
function buildRadiusSamplePoints(centerLat, centerLng, radiusKm, stepKm) {
  const points = [];

  const latKm = 111.32;

  const lngKm = Math.max(
    111.32 * Math.cos((centerLat * Math.PI) / 180),
    0.0001,
  );

  for (let northKm = -radiusKm; northKm <= radiusKm; northKm += stepKm) {
    for (let eastKm = -radiusKm; eastKm <= radiusKm; eastKm += stepKm) {
      const distanceKm = Math.hypot(northKm, eastKm);

      if (distanceKm > radiusKm) continue;

      points.push({
        lat: centerLat + northKm / latKm,
        lng: centerLng + eastKm / lngKm,
        distanceKm,
      });
    }
  }

  return points;
}

// ─── Remove Heatmap Layers ───────────────────────────────────────────────────
function removeHeatmapLayers() {
  if (heatLayer) {
    leafletMap.removeLayer(heatLayer);
    heatLayer = null;
  }

  if (heatRegionLayer) {
    leafletMap.removeLayer(heatRegionLayer);
    heatRegionLayer = null;
  }

  if (heatRadiusLayer) {
    leafletMap.removeLayer(heatRadiusLayer);
    heatRadiusLayer = null;
  }

  if (heatLegendControl) {
    leafletMap.removeControl(heatLegendControl);
    heatLegendControl = null;
  }
}

// ─── Heatmap Legend ──────────────────────────────────────────────────────────
function addHeatmapLegend() {
  heatLegendControl = L.control({
    position: "bottomright",
  });

  heatLegendControl.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-risk-legend");

    div.innerHTML = `
      <div>
        <span style="background:${RISK_MAP_COLORS.Low}"></span>
        Safe
      </div>

      <div>
        <span style="background:${RISK_MAP_COLORS.Medium}"></span>
        Moderate
      </div>

      <div>
        <span style="background:${RISK_MAP_COLORS.High}"></span>
        Danger
      </div>
    `;

    L.DomEvent.disableClickPropagation(div);

    return div;
  };

  heatLegendControl.addTo(leafletMap);
}

// ─── Fetch Heatmap Sample ────────────────────────────────────────────────────
async function fetchHeatmapSample(point, soil, vegetation) {
  const { res, data } = await fetchCoordinateAssessment(
    point.lat,
    point.lng,
    soil,
    vegetation,
  );

  return res.ok ? data : null;
}

// ─── Generate Heatmap ────────────────────────────────────────────────────────
async function generateHeatmap(centerLat, centerLng) {
  if (heatmapRunning) return;

  const soil = document.getElementById("soilSelect").value;
  const vegetation = document.getElementById("vegSelect").value;

  if (!soil || !vegetation) {
    showError(
      "Please select Soil Type and Vegetation Cover before generating a heatmap.",
    );
    return;
  }

  hideError();

  heatmapRunning = true;

  const overlay = document.getElementById("heatmapOverlay");
  const statusEl = document.getElementById("heatmapStatus");
  const progressEl = document.getElementById("heatmapProgress");

  const points = buildRadiusSamplePoints(
    centerLat,
    centerLng,
    HEATMAP_RADIUS_KM,
    HEATMAP_STEP_KM,
  );

  const heatData = [];
  const classifiedMarkers = [];

  const batchSize = 5;
  let done = 0;

  overlay.style.display = "flex";
  statusEl.textContent = `Sampling ${HEATMAP_RADIUS_KM}km radius...`;
  progressEl.style.width = "0%";

  try {
    for (let start = 0; start < points.length; start += batchSize) {
      const batch = points.slice(start, start + batchSize);

      const results = await Promise.allSettled(
        batch.map((pt) => fetchHeatmapSample(pt, soil, vegetation)),
      );

      results.forEach((result, index) => {
        const data = result.status === "fulfilled" ? result.value : null;

        if (!data) return;

        const pt = batch[index];

        const color = RISK_MAP_COLORS[data.risk_level] || RISK_MAP_COLORS.Low;

        heatData.push([pt.lat, pt.lng, data.total_score / 100]);

        const sampleMarker = L.circleMarker([pt.lat, pt.lng], {
          radius: 8,
          stroke: true,
          color,
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.78,
        }).bindTooltip(
          `${
            data.risk_level === "Low"
              ? "Safe"
              : data.risk_level === "Medium"
                ? "Moderate"
                : "Danger"
          }: ${data.total_score}/100`,
          {
            direction: "top",
          },
        );

        sampleMarker.on("click", async (event) => {
          if (mapMode !== "pin") return;

          L.DomEvent.stopPropagation(event.originalEvent);

          const label = await reverseGeocode(pt.lat, pt.lng);

          await addPinnedAssessment(pt.lat, pt.lng, data, label);
        });

        classifiedMarkers.push(sampleMarker);
      });

      done += batch.length;

      const pct = Math.round((done / points.length) * 100);

      progressEl.style.width = `${pct}%`;

      statusEl.textContent = `Sampled ${done} / ${points.length} points...`;
    }

    if (!heatData.length) {
      showError(
        "Could not generate the heatmap. Check that the backend is running and try again.",
      );
      return;
    }

    removeHeatmapLayers();

    heatRadiusLayer = L.circle([centerLat, centerLng], {
      radius: HEATMAP_RADIUS_KM * 1000,
      color: "#22d3ee",
      weight: 1.5,
      fill: false,
      dashArray: "6 6",
    }).addTo(leafletMap);

    // Requires the Leaflet.heat plugin to be loaded
    heatLayer = L.heatLayer(heatData, {
      radius: 32,
      blur: 18,
      maxZoom: 14,
      gradient: {
        0.0: RISK_MAP_COLORS.Low,
        0.39: RISK_MAP_COLORS.Low,
        0.4: RISK_MAP_COLORS.Medium,
        0.69: RISK_MAP_COLORS.Medium,
        0.7: RISK_MAP_COLORS.High,
        1.0: RISK_MAP_COLORS.High,
      },
    }).addTo(leafletMap);

    heatRegionLayer = L.layerGroup(classifiedMarkers).addTo(leafletMap);

    addHeatmapLegend();

    leafletMap.fitBounds(heatRadiusLayer.getBounds(), {
      padding: [24, 24],
    });
  } catch (err) {
    console.error("Heatmap generation error:", err);

    showError(
      "An error occurred while generating the heatmap. Check the browser console and backend.",
    );
  } finally {
    overlay.style.display = "none";
    heatmapRunning = false;
  }
}

// ─── Clear Map ───────────────────────────────────────────────────────────────
function clearMap() {
  if (!leafletMap) return;

  pinMarkers.forEach((marker) => {
    leafletMap.removeLayer(marker);
  });

  pinMarkers = [];

  removeHeatmapLayers();

  document.getElementById("heatmapOverlay").style.display = "none";

  heatmapRunning = false;
}

// ─── Reverse Geocoding ───────────────────────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      {
        headers: {
          "Accept-Language": "en",
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Reverse geocoding failed: ${res.status}`);
    }

    const data = await res.json();
    const address = data.address || {};

    return (
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      address.state_district ||
      address.state ||
      "Unknown Location"
    );
  } catch (err) {
    console.warn("Reverse geocoding error:", err);

    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
}

// ─── Risk Colors ─────────────────────────────────────────────────────────────
const RISK_COLORS = {
  Low: {
    primary: "#34d399",
    bg: "rgba(52,211,153,0.15)",
    glow: "rgba(52,211,153,0.3)",
  },

  Medium: {
    primary: "#fbbf24",
    bg: "rgba(251,191,36,0.15)",
    glow: "rgba(251,191,36,0.3)",
  },

  High: {
    primary: "#fb7185",
    bg: "rgba(251,113,133,0.15)",
    glow: "rgba(251,113,133,0.3)",
  },
};

// ─── Main Risk Assessment ────────────────────────────────────────────────────
async function assessRisk() {
  const city = document.getElementById("cityInput").value.trim();

  const soil = document.getElementById("soilSelect").value;

  const vegetation = document.getElementById("vegSelect").value;

  if (!city) {
    showError("Please enter a city name.");
    return;
  }

  if (!soil) {
    showError("Please select a soil type.");
    return;
  }

  if (!vegetation) {
    showError("Please select vegetation cover.");
    return;
  }

  hideError();
  setLoading(true);

  try {
    const res = await fetch(`${API_BASE}/assess`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        city,
        soil,
        vegetation,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Something went wrong. Please try again.");
      return;
    }

    currentData = data;

    renderDashboard(data);
  } catch (err) {
    console.error("Risk assessment error:", err);

    showError(
      "Cannot reach the server. Make sure the Flask backend is running on port 5001.",
    );
  } finally {
    setLoading(false);
  }
}

// ─── Dashboard Renderer ──────────────────────────────────────────────────────
function renderDashboard(data) {
  const dashboard = document.getElementById("dashboard");

  dashboard.style.display = "block";

  setTimeout(() => {
    dashboard.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 100);

  renderRiskBadge(data);
  renderGauge(data.total_score, data.risk_level);
  renderBarChart(data.scores);
  renderExplanation(data.explanation);
  renderRawData(data);
  renderWarnings(data.warnings || []);
}

// ─── Risk Badge ──────────────────────────────────────────────────────────────
function renderRiskBadge(data) {
  const card = document.getElementById("riskBadgeCard");
  const levelText = document.getElementById("riskLevelText");
  const cityName = document.getElementById("cityName");
  const totalScore = document.getElementById("totalScore");

  card.classList.remove("risk-low", "risk-medium", "risk-high");

  card.classList.add(`risk-${data.risk_level.toLowerCase()}`);

  levelText.textContent = data.risk_level;
  cityName.textContent = data.city;

  totalScore.textContent = `Score: ${data.total_score} / 100`;
}

// ─── Gauge Chart ─────────────────────────────────────────────────────────────
function renderGauge(score, riskLevel) {
  const ctx = document.getElementById("gaugeChart").getContext("2d");

  const colors = RISK_COLORS[riskLevel] || RISK_COLORS.Medium;

  const scoreEl = document.getElementById("gaugeScore");

  if (gaugeChartInstance) {
    gaugeChartInstance.destroy();
  }

  gaugeChartInstance = new Chart(ctx, {
    type: "doughnut",

    data: {
      datasets: [
        {
          data: [score, 100 - score],

          backgroundColor: [colors.primary, "rgba(30, 41, 59, 0.5)"],

          borderWidth: 0,
          circumference: 180,
          rotation: 270,
        },
      ],
    },

    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "78%",

      plugins: {
        legend: {
          display: false,
        },

        tooltip: {
          enabled: false,
        },
      },

      animation: {
        animateRotate: true,
        duration: 1200,
        easing: "easeOutQuart",
      },
    },
  });

  animateNumber(scoreEl, 0, score, 1000);
}

// ─── Bar Chart ───────────────────────────────────────────────────────────────
function renderBarChart(scores) {
  const ctx = document.getElementById("barChart").getContext("2d");

  if (barChartInstance) {
    barChartInstance.destroy();
  }

  const labels = ["Rainfall", "Elevation", "Soil", "Vegetation", "Bonus"];

  const values = [
    scores.rainfall,
    scores.elevation,
    scores.soil,
    scores.vegetation,
    scores.bonus,
  ];

  const maxVals = [25, 25, 20, 20, 10];

  const barColors = [
    "rgba(34, 211, 238, 0.8)",
    "rgba(167, 139, 250, 0.8)",
    "rgba(52, 211, 153, 0.8)",
    "rgba(251, 191, 36, 0.8)",
    "rgba(251, 113, 133, 0.8)",
  ];

  const borderColors = [
    "rgba(34, 211, 238, 1)",
    "rgba(167, 139, 250, 1)",
    "rgba(52, 211, 153, 1)",
    "rgba(251, 191, 36, 1)",
    "rgba(251, 113, 133, 1)",
  ];

  barChartInstance = new Chart(ctx, {
    type: "bar",

    data: {
      labels: labels.map((label, i) => `${label} (${values[i]}/${maxVals[i]})`),

      datasets: [
        {
          label: "Score",
          data: values,
          backgroundColor: barColors,
          borderColor: borderColors,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",

      scales: {
        x: {
          max: 25,

          grid: {
            color: "rgba(148, 163, 184, 0.06)",
          },

          ticks: {
            color: "#64748b",
            font: {
              family: "Inter",
              size: 11,
            },
          },
        },

        y: {
          grid: {
            display: false,
          },

          ticks: {
            color: "#94a3b8",

            font: {
              family: "Inter",
              size: 11,
              weight: 500,
            },
          },
        },
      },

      plugins: {
        legend: {
          display: false,
        },

        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",

          titleFont: {
            family: "Inter",
            weight: 600,
          },

          bodyFont: {
            family: "Inter",
          },

          borderColor: "rgba(148, 163, 184, 0.15)",
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
        },
      },

      animation: {
        duration: 1000,
        easing: "easeOutQuart",
      },
    },
  });
}

// ─── AI Explanation ──────────────────────────────────────────────────────────
function renderExplanation(text) {
  document.getElementById("explanationText").textContent = text;
}

// ─── Raw Environmental Data ──────────────────────────────────────────────────
function renderRawData(data) {
  const grid = document.getElementById("dataGrid");

  const items = [
    {
      value: `${data.raw.rainfall_mm} mm/h`,
      label: "Max Rainfall",
    },
    {
      value: `${data.raw.elevation_m} m`,
      label: "Elevation",
    },
    {
      value: `${data.raw.slope_deg}°`,
      label: "Slope",
    },
    {
      value: `${data.raw.latitude}°`,
      label: "Latitude",
    },
    {
      value: `${data.raw.longitude}°`,
      label: "Longitude",
    },
  ];

  grid.innerHTML = items
    .map(
      (item) => `
        <div class="data-item">
          <div class="data-value">${item.value}</div>
          <div class="data-label">${item.label}</div>
        </div>
      `,
    )
    .join("");
}

// ─── Warnings ────────────────────────────────────────────────────────────────
function renderWarnings(warnings) {
  const container = document.getElementById("warningsContainer");

  if (!warnings.length) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";

  container.innerHTML = warnings
    .map(
      (warning) => `
        <div class="warning-item">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>

          ${warning}
        </div>
      `,
    )
    .join("");
}

// ─── PDF Export ──────────────────────────────────────────────────────────────
function downloadPDF() {
  if (!currentData) return;

  let doc;

  if (window.jspdf && window.jspdf.jsPDF) {
    doc = new window.jspdf.jsPDF();
  } else if (window.jsPDF) {
    doc = new window.jsPDF();
  } else {
    alert(
      "jsPDF library is not loaded yet. Please wait a moment and try again.",
    );
    return;
  }

  const data = currentData;
  const margin = 20;
  let y = 20;

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");

  doc.text("Landslide Risk Assessment Report", margin, y);

  y += 10;

  // Subtitle
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);

  doc.text("Generated by TerraSense — Real-Time Risk Intelligence", margin, y);

  doc.setTextColor(0);
  y += 6;

  // Divider
  doc.setDrawColor(200);
  doc.line(margin, y, 190, y);

  y += 12;

  // City and risk level
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");

  doc.text(`City: ${data.city}`, margin, y);
  y += 8;

  doc.text(`Risk Level: ${data.risk_level}`, margin, y);
  y += 8;

  doc.text(`Total Score: ${data.total_score} / 100`, margin, y);

  y += 14;

  // Divider
  doc.setDrawColor(220);
  doc.line(margin, y, 190, y);

  y += 10;

  // Parameter scores
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Parameter Scores", margin, y);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const scoreLines = [
    `Rainfall:        ${data.scores.rainfall} / 25`,
    `Slope/Elevation: ${data.scores.elevation} / 25`,
    `Soil Type:       ${data.scores.soil} / 20`,
    `Vegetation:      ${data.scores.vegetation} / 20`,
    `Instability:     ${data.scores.bonus} / 10`,
  ];

  scoreLines.forEach((line) => {
    doc.text(line, margin + 4, y);
    y += 7;
  });

  y += 6;

  // Environmental data
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);

  doc.text("Environmental Data", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const rawLines = [
    `Rainfall:   ${data.raw.rainfall_mm} mm/h`,
    `Elevation:  ${data.raw.elevation_m} m`,
    `Slope:      ${data.raw.slope_deg}°`,
    `Latitude:   ${data.raw.latitude}°`,
    `Longitude:  ${data.raw.longitude}°`,
  ];

  rawLines.forEach((line) => {
    doc.text(line, margin + 4, y);
    y += 7;
  });

  y += 6;

  // AI explanation
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);

  doc.text("AI Analysis", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const explanationLines = doc.splitTextToSize(data.explanation, 170);

  doc.text(explanationLines, margin + 4, y);

  y += explanationLines.length * 5 + 10;

  // Footer
  doc.setDrawColor(200);
  doc.line(margin, y, 190, y);

  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(140);

  doc.text("TerraSense © 2026 — DSCE Innovation & Design Thinking", margin, y);

  y += 5;

  doc.text(`Report generated on ${new Date().toLocaleString()}`, margin, y);

  doc.save(`${data.city.replace(/\s+/g, "_")}_landslide_report.pdf`);
}

// ─── Animated Number ─────────────────────────────────────────────────────────
function animateNumber(element, start, end, duration) {
  const startTime = performance.now();
  const range = end - start;

  function update(currentTime) {
    const elapsed = currentTime - startTime;

    const progress = Math.min(elapsed / duration, 1);

    const eased = 1 - Math.pow(1 - progress, 4);

    const current = Math.round(start + range * eased);

    element.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ─── Error Handling ──────────────────────────────────────────────────────────
function showError(message) {
  const banner = document.getElementById("errorBanner");
  const text = document.getElementById("errorText");

  text.textContent = message;
  banner.style.display = "flex";
}

function hideError() {
  document.getElementById("errorBanner").style.display = "none";
}

// ─── Loading State ───────────────────────────────────────────────────────────
function setLoading(isLoading) {
  const button = document.getElementById("assessBtn");

  if (isLoading) {
    button.classList.add("loading");
  } else {
    button.classList.remove("loading");
  }
}

// ─── Keyboard Support and Initialisation ─────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("cityInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      assessRisk();
    }
  });

  initMap();
});
