// Storage keys and QR sizing constants used across the app.
const STORAGE_KEYS = {
    history: "kindreturn-history-v1"
};

const DEFAULT_CENTER = [3.139, 101.6869];
const DEFAULT_COORDINATE_HINT = "Coordinates auto-fill from the address. You can adjust them manually before generating.";
const QR_RENDER_SIZE = 320;
const QR_RENDER_SIZE_LARGE = 360;
const QR_DOWNLOAD_SIZE = 1400;
const QR_DOWNLOAD_PADDING = 140;
const KINDNESS_MESSAGES = [
    "Someone's difficult day can end because you chose honesty.",
    "Returning one item is a small act with a very big ripple.",
    "Good people make the world feel safer for strangers.",
    "A simple phone call can turn panic into relief.",
    "Kindness is still modern, useful, and worth practicing every day."
];

// Runtime app state for the single-page flow.
const state = {
    activeSection: "home",
    history: [],
    currentQrData: null,
    currentLocation: null,
    currentAddress: "",
    map: null,
    destinationMarker: null,
    currentMarker: null,
    routeLayer: null,
    scanner: null,
    scannerRunning: false,
    pendingDeleteId: null,
    toastTimer: null,
    kindnessIntervalId: null,
    kindnessSwapTimeoutId: null,
    addressLookupTimer: null,
    lastAddressLookupId: 0,
    coordinateSource: "empty"
};

// Cached DOM references are populated once on startup.
const refs = {};

// Boot the app after the DOM and CDN-backed libraries are ready.
document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    bindEvents();
    initMap();
    loadLocalHistory();
    renderHistory();
    updateHomeStats();
    setRandomKindnessMessage(false, false);
    startKindnessRotation();
    renderLatestItem();
    setActiveSection("home");
});

// Cache frequently used elements to avoid repeated DOM lookups.
function cacheDom() {
    refs.sidebar = document.getElementById("sidebar");
    refs.sidebarOverlay = document.getElementById("sidebarOverlay");
    refs.locationStatusText = document.getElementById("locationStatusText");
    refs.scanCountValue = document.getElementById("scanCountValue");
    refs.syncModeValue = document.getElementById("syncModeValue");
    refs.homeDestinationValue = document.getElementById("homeDestinationValue");
    refs.homeLatestCard = document.getElementById("homeLatestCard");
    refs.mapItemDetails = document.getElementById("mapItemDetails");
    refs.distanceValue = document.getElementById("distanceValue");
    refs.durationValue = document.getElementById("durationValue");
    refs.googleMapsLink = document.getElementById("googleMapsLink");
    refs.scannerHint = document.getElementById("scannerHint");
    refs.scanResultCard = document.getElementById("scanResultCard");
    refs.scanResultContent = document.getElementById("scanResultContent");
    refs.qrFileInput = document.getElementById("qrFileInput");
    refs.generateForm = document.getElementById("generateForm");
    refs.generatedCard = document.getElementById("generatedCard");
    refs.generatedSummary = document.getElementById("generatedSummary");
    refs.historyList = document.getElementById("historyList");
    refs.deleteModal = document.getElementById("deleteModal");
    refs.toast = document.getElementById("toast");
    refs.kindnessMessage = document.getElementById("kindnessMessage");
    refs.addressInput = document.getElementById("addressInput");
    refs.latitudeInput = document.getElementById("latitudeInput");
    refs.longitudeInput = document.getElementById("longitudeInput");
    refs.coordinateHint = document.getElementById("coordinateHint");
}

// Wire the app shell to section navigation, scanner controls, and generator actions.
function bindEvents() {
    document.getElementById("openSidebarBtn").addEventListener("click", openSidebar);
    document.getElementById("closeSidebarBtn").addEventListener("click", closeSidebar);
    refs.sidebarOverlay.addEventListener("click", closeSidebar);
    document.getElementById("newMessageBtn").addEventListener("click", () => {
        setRandomKindnessMessage(true);
        startKindnessRotation();
    });
    document.getElementById("refreshLocationBtn").addEventListener("click", () => ensureCurrentLocation(true));
    document.getElementById("centerMapLocationBtn").addEventListener("click", centerMapOnCurrentLocation);

    document.querySelectorAll("[data-nav-section]").forEach((button) => {
        button.addEventListener("click", () => {
            setActiveSection(button.dataset.navSection);
            closeSidebar();
        });
    });

    document.getElementById("startScannerBtn").addEventListener("click", startCameraScanner);
    document.getElementById("uploadQrBtn").addEventListener("click", () => refs.qrFileInput.click());
    refs.qrFileInput.addEventListener("change", handleQrImageUpload);

    refs.addressInput.addEventListener("input", handleAddressInputChange);
    refs.addressInput.addEventListener("blur", handleAddressInputBlur);
    refs.latitudeInput.addEventListener("input", handleCoordinateInputChange);
    refs.longitudeInput.addEventListener("input", handleCoordinateInputChange);

    refs.generateForm.addEventListener("submit", handleGenerateQr);
    document.getElementById("downloadQrBtn").addEventListener("click", downloadQrCode);
    document.getElementById("copyPayloadBtn").addEventListener("click", copyCurrentQrPayload);
    document.getElementById("viewMapBtn").addEventListener("click", () => setActiveSection("maps"));
    document.getElementById("cancelDeleteBtn").addEventListener("click", closeDeleteModal);
    document.getElementById("confirmDeleteBtn").addEventListener("click", confirmDeleteHistoryItem);
}

function openSidebar() {
    refs.sidebar.classList.add("is-open");
    refs.sidebarOverlay.classList.add("is-visible");
    refs.sidebar.setAttribute("aria-hidden", "false");
}

function closeSidebar() {
    refs.sidebar.classList.remove("is-open");
    refs.sidebarOverlay.classList.remove("is-visible");
    refs.sidebar.setAttribute("aria-hidden", "true");
}

// Section switching keeps the app single-page and closes temporary UI when needed.
function setActiveSection(section) {
    state.activeSection = section;
    document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === section);
    });
    document.querySelectorAll("[data-nav-section]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.navSection === section);
    });
    if (section !== "scanner") {
        stopScanner();
    }
    if (section === "maps" && state.map) {
        window.setTimeout(() => {
            state.map.invalidateSize();
            pinCurrentLocationOnMap();
        }, 140);
    }
}

// The home message rotates automatically, but can also be manually advanced.
function setRandomKindnessMessage(avoidRepeat = false, animate = true) {
    const current = refs.kindnessMessage.textContent;
    let next = KINDNESS_MESSAGES[Math.floor(Math.random() * KINDNESS_MESSAGES.length)];
    if (avoidRepeat && KINDNESS_MESSAGES.length > 1) {
        while (next === current) {
            next = KINDNESS_MESSAGES[Math.floor(Math.random() * KINDNESS_MESSAGES.length)];
        }
    }

    window.clearTimeout(state.kindnessSwapTimeoutId);

    if (!animate) {
        refs.kindnessMessage.textContent = next;
        refs.kindnessMessage.classList.remove("is-swapping");
        return;
    }

    refs.kindnessMessage.classList.add("is-swapping");
    state.kindnessSwapTimeoutId = window.setTimeout(() => {
        refs.kindnessMessage.textContent = next;
        refs.kindnessMessage.classList.remove("is-swapping");
    }, 220);
}

function startKindnessRotation() {
    window.clearInterval(state.kindnessIntervalId);
    state.kindnessIntervalId = window.setInterval(() => {
        setRandomKindnessMessage(true);
    }, 5000);
}

// Leaflet handles the map display while routing is fetched separately.
function initMap() {
    if (!window.L) {
        refs.mapItemDetails.textContent = "Map library failed to load.";
        return;
    }
    state.map = L.map("map", { zoomControl: false }).setView(DEFAULT_CENTER, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
    }).addTo(state.map);
    L.control.zoom({ position: "topright" }).addTo(state.map);
}

function loadLocalHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.history)) || [];
        state.history = Array.isArray(saved)
            ? saved.map((record) => ({
                ...record,
                remoteId: null,
                syncStatus: "local"
            }))
            : [];
    } catch (error) {
        state.history = [];
    }
}

function saveLocalHistory() {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(state.history));
}

// Location is only requested when the user needs routing or scan-location logging.
async function ensureCurrentLocation(showFeedback = false) {
    if (state.currentLocation && state.currentAddress) {
        if (showFeedback) {
            showToast("Current location already ready.");
        }
        return state.currentLocation;
    }
    refs.locationStatusText.textContent = "Locating...";
    try {
        const position = await getCurrentPosition();
        state.currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        state.currentAddress = await reverseGeocode(state.currentLocation.lat, state.currentLocation.lng);
        refs.locationStatusText.textContent = state.currentAddress || "Location ready";
        renderCurrentLocationMarker();
        if (state.currentQrData) {
            updateMapForQrData(state.currentQrData);
        }
        if (showFeedback) {
            showToast("Current location captured.");
        }
        return state.currentLocation;
    } catch (error) {
        refs.locationStatusText.textContent = "Location unavailable";
        if (showFeedback) {
            showToast("Unable to access your current location.");
        }
        return null;
    }
}

async function centerMapOnCurrentLocation() {
    const location = await ensureCurrentLocation(true);
    if (!location || !state.map) {
        return;
    }

    renderCurrentLocationMarker();
    state.map.flyTo([location.lat, location.lng], 15, {
        duration: 0.8
    });
    state.currentMarker?.openPopup();
}

async function pinCurrentLocationOnMap() {
    const location = await ensureCurrentLocation(false);
    if (!location || !state.map) {
        return;
    }

    renderCurrentLocationMarker();

    if (!state.currentQrData) {
        state.map.setView([location.lat, location.lng], 15);
    }
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported."));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0
        });
    });
}

function handleAddressInputChange() {
    if (state.coordinateSource === "auto") {
        clearCoordinateInputs();
    }
    queueCoordinateAutofill(false);
}

function handleAddressInputBlur() {
    queueCoordinateAutofill(true);
}

function handleCoordinateInputChange() {
    const hasAnyCoordinateValue = Boolean(refs.latitudeInput.value.trim() || refs.longitudeInput.value.trim());
    state.coordinateSource = hasAnyCoordinateValue ? "manual" : "empty";
    refs.coordinateHint.textContent = hasAnyCoordinateValue
        ? "These coordinates will be saved into the QR."
        : DEFAULT_COORDINATE_HINT;
}

function queueCoordinateAutofill(runImmediately) {
    const address = refs.addressInput.value.trim();
    window.clearTimeout(state.addressLookupTimer);

    if (!address) {
        clearCoordinateInputs();
        refs.coordinateHint.textContent = DEFAULT_COORDINATE_HINT;
        return;
    }

    refs.coordinateHint.textContent = "Looking up coordinates from the address...";
    const requestId = ++state.lastAddressLookupId;
    const runLookup = () => {
        autofillCoordinatesFromAddress(address, requestId);
    };

    if (runImmediately) {
        runLookup();
        return;
    }

    state.addressLookupTimer = window.setTimeout(runLookup, 650);
}

async function autofillCoordinatesFromAddress(address, requestId) {
    try {
        const geocodeResult = await geocodeAddress(address);
        if (requestId !== state.lastAddressLookupId || refs.addressInput.value.trim() !== address) {
            return;
        }

        const hasManualCoordinates = state.coordinateSource === "manual"
            && refs.latitudeInput.value.trim()
            && refs.longitudeInput.value.trim();

        if (hasManualCoordinates) {
            refs.coordinateHint.textContent = "Manual coordinates kept. Update them if the address changed.";
            return;
        }

        setCoordinateInputs({
            lat: geocodeResult.lat,
            lng: geocodeResult.lng
        }, "auto");
        refs.coordinateHint.textContent = "Coordinates auto-filled from the address.";
    } catch (error) {
        if (requestId !== state.lastAddressLookupId || refs.addressInput.value.trim() !== address) {
            return;
        }

        if (state.coordinateSource !== "manual") {
            clearCoordinateInputs();
        }

        refs.coordinateHint.textContent = state.coordinateSource === "manual"
            ? "Address lookup failed. Manual coordinates will still be used."
            : "Unable to auto-fill coordinates yet. You can enter them manually.";
    }
}

async function reverseGeocode(lat, lng) {
    try {
        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.search = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng) }).toString();
        const response = await fetch(url);
        const data = await response.json();
        return data.display_name || "Location address not found";
    } catch (error) {
        return "Location address not found";
    }
}

async function geocodeAddress(address) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ format: "jsonv2", limit: "1", q: address }).toString();
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Unable to geocode address.");
    }
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) {
        throw new Error("Address not found.");
    }
    return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        label: data[0].display_name
    };
}

async function getRoute(origin, destination) {
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`);
    if (!response.ok) {
        throw new Error("Unable to build route.");
    }
    const data = await response.json();
    if (!data.routes || !data.routes.length) {
        throw new Error("No route available.");
    }
    return data.routes[0];
}

// Generator flow: validate, geocode, then build a QR-friendly payload.
async function handleGenerateQr(event) {
    event.preventDefault();
    const name = document.getElementById("nameInput").value.trim();
    const address = refs.addressInput.value.trim();
    const phone = document.getElementById("phoneInput").value.trim();
    const email = document.getElementById("emailInput").value.trim();
    const remarks = document.getElementById("remarksInput").value.trim();
    const coordinateInput = getCoordinateInputValue();

    if (!address) {
        showToast("Address is required to generate the QR.");
        return;
    }
    if (!phone && !email) {
        showToast("Add at least a phone number or an email.");
        return;
    }
    if (coordinateInput.error) {
        showToast(coordinateInput.error);
        return;
    }

    const generateBtn = document.getElementById("generateBtn");
    const originalLabel = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";

    try {
        let coordinates = coordinateInput.value;
        let resolvedAddress = address;

        if (!coordinates) {
            try {
                const geocodeResult = await geocodeAddress(address);
                coordinates = normalizeCoordinates({ lat: geocodeResult.lat, lng: geocodeResult.lng });
                resolvedAddress = geocodeResult.label || address;
                if (coordinates) {
                    setCoordinateInputs(coordinates, "auto");
                    refs.coordinateHint.textContent = "Coordinates auto-filled from the address.";
                }
            } catch (error) {
                showToast("Address geocoding failed. QR created with the typed address only.");
            }
        }

        const payload = {
            type: "kindreturn-item",
            qrId: buildQrId(),
            name,
            address,
            phone,
            email,
            remarks,
            coordinates,
            resolvedAddress,
            googleMapsUrl: buildGoogleMapsLink({ address, coordinates }),
            createdAt: new Date().toISOString()
        };

        renderQrCode(payload);
        state.currentQrData = payload;
        refs.generatedSummary.innerHTML = buildQrSummaryMarkup(payload);
        refs.generatedCard.classList.remove("is-hidden");
        refs.homeDestinationValue.textContent = payload.name || "Unnamed item";
        renderLatestItem();
        updateMapForQrData(payload);
        updateHomeStats();
        showToast("QR code generated.");
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = originalLabel;
    }
}

function buildQrId() {
    const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `KR-${stamp}-${suffix}`;
}

// The QR text is intentionally human-readable so third-party scanners show useful data.
function serializeQrPayload(payload) {
    const coordinatesText = formatCoordinates(payload.coordinates);
    const mapUrl = buildGoogleMapsLink(payload);
    const lines = [
        "KINDRETURN ITEM",
        `QR ID: ${normalizeQrTextValue(payload.qrId)}`
    ];

    if (payload.name) {
        lines.push(`Name: ${normalizeQrTextValue(payload.name)}`);
    }

    if (payload.phone) {
        lines.push(`Phone: ${normalizeQrTextValue(payload.phone)}`);
    }

    if (payload.email) {
        lines.push(`Email: ${normalizeQrTextValue(payload.email)}`);
    }

    lines.push(`Address: ${normalizeQrTextValue(payload.address)}`);

    if (coordinatesText) {
        lines.push(`Coordinates: ${coordinatesText}`);
    }

    if (mapUrl) {
        lines.push(`Map URL: ${normalizeQrTextValue(mapUrl)}`);
    }

    if (payload.remarks) {
        lines.push(`Remarks: ${normalizeQrTextValue(payload.remarks)}`);
    }

    return lines.join("\n");
}

function normalizeQrTextValue(value) {
    return String(value ?? "")
        .replace(/\r?\n+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function buildQrDownloadFilename(payload) {
    const namePart = slugifyFilenamePart(payload?.name || "unnamed-item");
    const qrIdPart = slugifyFilenamePart(payload?.qrId || "kindreturn-qr");
    return `kindreturn-${namePart}-${qrIdPart}.png`;
}

function slugifyFilenamePart(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "item";
}

// Preview QR is optimized for on-screen use.
function renderQrCode(payload) {
    const target = document.getElementById("qrcode");
    target.innerHTML = "";
    const qrText = serializeQrPayload(payload);
    const qrSize = qrText.length > 220 ? QR_RENDER_SIZE_LARGE : QR_RENDER_SIZE;
    const shell = document.createElement("div");
    shell.className = "qr-canvas-shell";
    target.appendChild(shell);

    new QRCode(shell, {
        text: qrText,
        width: qrSize,
        height: qrSize,
        colorDark: "#2f1b0c",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
    });
}

function buildQrSummaryMarkup(payload) {
    const coordinatesText = formatCoordinates(payload.coordinates);
    return `
        <div class="detail-card__row">
            <span class="detail-chip">${escapeHtml(payload.qrId)}</span>
            <span class="detail-chip">${escapeHtml(payload.name || "Unnamed owner")}</span>
        </div>
        <div><strong>Address</strong><p>${escapeHtml(payload.address)}</p></div>
        ${coordinatesText ? `<div><strong>Coordinates</strong><p>${escapeHtml(coordinatesText)}</p></div>` : ""}
        <div><strong>Phone</strong><p>${escapeHtml(payload.phone || "Not provided")}</p></div>
        <div><strong>Email</strong><p>${escapeHtml(payload.email || "Not provided")}</p></div>
        <div><strong>Remarks</strong><p>${escapeHtml(payload.remarks || "None")}</p></div>
    `;
}

function buildGoogleMapsLink({ address, coordinates }) {
    const normalizedCoordinates = normalizeCoordinates(coordinates);
    if (normalizedCoordinates) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${formatCoordinateValue(normalizedCoordinates.lat)},${formatCoordinateValue(normalizedCoordinates.lng)}`)}`;
    }

    const normalizedAddress = String(address || "").trim();
    if (normalizedAddress) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalizedAddress)}`;
    }

    return "";
}

function setGoogleMapsLink(url) {
    if (url) {
        refs.googleMapsLink.classList.remove("is-disabled");
        refs.googleMapsLink.removeAttribute("aria-disabled");
        refs.googleMapsLink.href = url;
        return;
    }

    refs.googleMapsLink.classList.add("is-disabled");
    refs.googleMapsLink.setAttribute("aria-disabled", "true");
    refs.googleMapsLink.href = "#";
}

function clearRouteLayer() {
    if (state.routeLayer) {
        state.map?.removeLayer(state.routeLayer);
        state.routeLayer = null;
    }
}

function clearDestinationMarker() {
    if (state.destinationMarker) {
        state.map?.removeLayer(state.destinationMarker);
        state.destinationMarker = null;
    }
}

// Map updates geocode the saved address when coordinates are not embedded.
async function updateMapForQrData(payload) {
    if (!state.map || !payload) {
        return;
    }

    const extractedLocation = extractQrLocation(payload);
    let destination = normalizeCoordinates(payload.coordinates) || extractedLocation?.coordinates || null;
    const resolvedAddress = payload.address || extractedLocation?.address || payload.resolvedAddress || "";

    if (!destination?.lat || !destination?.lng) {
        try {
            destination = resolvedAddress ? await geocodeAddress(resolvedAddress) : null;
        } catch (error) {
            clearDestinationMarker();
            clearRouteLayer();
            refs.distanceValue.textContent = "Address not resolved";
            refs.durationValue.textContent = "Address not resolved";
            refs.mapItemDetails.innerHTML = `<div class="empty-card">Unable to geocode the saved address or coordinates from this QR code.</div>`;
            setGoogleMapsLink(buildGoogleMapsLink({ address: resolvedAddress }) || payload.googleMapsUrl || extractedLocation?.url || "");
            return;
        }
    }

    if (!destination) {
        clearDestinationMarker();
        clearRouteLayer();
        refs.distanceValue.textContent = "No destination";
        refs.durationValue.textContent = "No destination";
        refs.mapItemDetails.innerHTML = `<div class="empty-card">This QR code does not contain a mappable address or coordinates.</div>`;
        setGoogleMapsLink(payload.googleMapsUrl || extractedLocation?.url || "");
        return;
    }

    state.currentQrData = {
        ...payload,
        address: resolvedAddress,
        resolvedAddress,
        coordinates: normalizeCoordinates(destination),
        googleMapsUrl: buildGoogleMapsLink({ address: resolvedAddress, coordinates: destination }) || payload.googleMapsUrl || extractedLocation?.url || ""
    };

    renderDestinationMarker(state.currentQrData.coordinates);
    setGoogleMapsLink(state.currentQrData.googleMapsUrl);
    refs.mapItemDetails.innerHTML = buildMapDetailMarkup(state.currentQrData);
    refs.homeDestinationValue.textContent = payload.name || "Unnamed item";

    if (state.currentLocation) {
        renderCurrentLocationMarker();
        await updateRouteOnMap(state.currentLocation, state.currentQrData.coordinates);
    } else {
        clearRouteLayer();
        refs.distanceValue.textContent = "Enable location";
        refs.durationValue.textContent = "Enable location";
        state.map.setView([state.currentQrData.coordinates.lat, state.currentQrData.coordinates.lng], 14);
    }
}

async function updateRouteOnMap(origin, destination) {
    try {
        const route = await getRoute(origin, destination);
        refs.distanceValue.textContent = `${(route.distance / 1000).toFixed(1)} km`;
        refs.durationValue.textContent = formatDuration(route.duration / 60);

        if (state.routeLayer) {
            state.map.removeLayer(state.routeLayer);
        }

        state.routeLayer = L.geoJSON(route.geometry, {
            style: { color: "#e77712", weight: 5, opacity: 0.9 }
        }).addTo(state.map);

        const group = L.featureGroup([state.destinationMarker, state.currentMarker, state.routeLayer].filter(Boolean));
        state.map.fitBounds(group.getBounds().pad(0.2));
    } catch (error) {
        refs.distanceValue.textContent = "Route unavailable";
        refs.durationValue.textContent = "Route unavailable";
        if (state.destinationMarker && state.currentMarker) {
            const bounds = L.latLngBounds(
                [state.currentLocation.lat, state.currentLocation.lng],
                [destination.lat, destination.lng]
            );
            state.map.fitBounds(bounds.pad(0.25));
        }
    }
}

function renderDestinationMarker(coordinates) {
    const normalizedCoordinates = normalizeCoordinates(coordinates);
    if (!normalizedCoordinates) {
        return;
    }
    if (state.destinationMarker) {
        state.map.removeLayer(state.destinationMarker);
    }
    const icon = L.divIcon({ className: "owner-pin", iconSize: [24, 24], iconAnchor: [12, 12] });
    state.destinationMarker = L.marker([normalizedCoordinates.lat, normalizedCoordinates.lng], { icon }).addTo(state.map);
    state.destinationMarker.bindPopup("QR destination");
}

function renderCurrentLocationMarker() {
    if (!state.map || !state.currentLocation) {
        return;
    }
    if (state.currentMarker) {
        state.map.removeLayer(state.currentMarker);
    }
    const icon = L.divIcon({ className: "user-pin", iconSize: [24, 24], iconAnchor: [12, 12] });
    state.currentMarker = L.marker([state.currentLocation.lat, state.currentLocation.lng], { icon }).addTo(state.map);
    state.currentMarker.bindPopup("Your current location");
}

function buildMapDetailMarkup(payload) {
    const coordinatesText = formatCoordinates(payload.coordinates);
    const title = payload.type === "kindreturn-item"
        ? (payload.name || "Unnamed owner")
        : (payload.name || "Pinned map location");

    return `
        <div class="detail-card">
            <div class="detail-card__row">
                <span class="detail-chip">${escapeHtml(payload.qrId || "No QR ID")}</span>
                <span class="detail-chip">${escapeHtml(title)}</span>
            </div>
            <div><strong>Address</strong><p>${escapeHtml(payload.address || "Not provided")}</p></div>
            ${coordinatesText ? `<div><strong>Coordinates</strong><p>${escapeHtml(coordinatesText)}</p></div>` : ""}
            <div><strong>Phone</strong><p>${escapeHtml(payload.phone || "Not provided")}</p></div>
            <div><strong>Email</strong><p>${escapeHtml(payload.email || "Not provided")}</p></div>
            <div><strong>Remarks</strong><p>${escapeHtml(payload.remarks || "None")}</p></div>
        </div>
    `;
}

// Scanner accepts both camera input and uploaded QR images.
async function startCameraScanner() {
    if (!window.Html5Qrcode) {
        showToast("QR scanner library failed to load.");
        return;
    }
    if (state.scannerRunning) {
        showToast("Scanner is already running.");
        return;
    }

    refs.scannerHint.textContent = "Preparing camera...";
    try {
        if (!state.scanner) {
            state.scanner = new Html5Qrcode("reader");
        }
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras.length) {
            throw new Error("No camera found.");
        }
        const preferredCamera = cameras.find((camera) => /back|rear|environment|0/i.test(camera.label)) || cameras[0];
        await state.scanner.start(
            preferredCamera.id,
            { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
            async (decodedText) => {
                await handleScanSuccess(decodedText);
            },
            () => {}
        );
        state.scannerRunning = true;
        refs.scannerHint.textContent = "Camera ready. Point it at a QR code.";
    } catch (error) {
        refs.scannerHint.textContent = "Camera unavailable. Try image upload instead.";
        showToast("Unable to open the camera.");
    }
}

async function stopScanner() {
    if (!state.scanner) {
        return;
    }
    try {
        if (state.scannerRunning) {
            await state.scanner.stop();
        }
        await state.scanner.clear();
    } catch (error) {
        // Ignore cleanup failures.
    } finally {
        state.scannerRunning = false;
        state.scanner = null;
        refs.scannerHint.textContent = "Allow camera permission or upload an image containing the QR code.";
        document.getElementById("reader").innerHTML = "";
    }
}

async function handleQrImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }
    if (!window.Html5Qrcode) {
        showToast("QR scanner library failed to load.");
        return;
    }
    refs.scannerHint.textContent = "Reading QR image...";
    try {
        if (!state.scanner) {
            state.scanner = new Html5Qrcode("reader");
        }
        const decodedText = await state.scanner.scanFile(file, true);
        await handleScanSuccess(decodedText);
        refs.scannerHint.textContent = "QR image decoded successfully.";
    } catch (error) {
        refs.scannerHint.textContent = "Unable to decode that image.";
        showToast("Failed to decode QR image.");
    } finally {
        refs.qrFileInput.value = "";
    }
}

async function handleScanSuccess(decodedText) {
    await stopScanner();
    const qrData = parseQrPayload(decodedText);
    state.currentQrData = qrData;
    await ensureCurrentLocation(false);
    refs.scanResultCard.classList.remove("is-hidden");
    refs.scanResultContent.innerHTML = buildScanResultMarkup(qrData, decodedText);
    if (qrData.address || qrData.coordinates || qrData.googleMapsUrl) {
        await updateMapForQrData(qrData);
    }
    renderLatestItem();
    showToast("QR code scanned.");
    if (qrData.type === "kindreturn-item") {
        await saveScanHistory(qrData);
    }
    attachResultActionHandlers();
}

// Parsing supports both the old JSON format and the newer readable text format.
function parseQrPayload(decodedText) {
    try {
        const parsed = JSON.parse(decodedText);
        if (parsed && parsed.type === "kindreturn-item") {
            const extractedLocation = extractQrLocation(parsed);
            const coordinates = normalizeCoordinates(parsed.coordinates) || extractedLocation?.coordinates || null;
            return {
                type: "kindreturn-item",
                qrId: parsed.qrId || buildQrId(),
                name: parsed.name || "",
                address: parsed.address || "",
                phone: parsed.phone || "",
                email: parsed.email || "",
                remarks: parsed.remarks || "",
                coordinates,
                resolvedAddress: parsed.resolvedAddress || parsed.address || "",
                googleMapsUrl: parsed.googleMapsUrl || buildGoogleMapsLink({ address: parsed.address, coordinates }) || extractedLocation?.url || "",
                createdAt: parsed.createdAt || new Date().toISOString(),
                rawText: decodedText
            };
        }
    } catch (error) {
        // Fall back to plain text.
    }

    const textPayload = parseKindReturnTextPayload(decodedText);
    if (textPayload) {
        return textPayload;
    }

    const mapUrlPayload = parseMapUrlPayload(decodedText);
    if (mapUrlPayload) {
        return mapUrlPayload;
    }

    return {
        type: "external-qr",
        qrId: "EXTERNAL-QR",
        name: "",
        address: "",
        phone: "",
        email: "",
        remarks: decodedText,
        coordinates: null,
        resolvedAddress: "",
        googleMapsUrl: "",
        createdAt: new Date().toISOString(),
        rawText: decodedText
    };
}

function parseKindReturnTextPayload(decodedText) {
    const normalizedText = String(decodedText || "").replace(/\r/g, "").trim();
    if (!normalizedText || !/^KINDRETURN ITEM/i.test(normalizedText)) {
        return null;
    }

    const fields = {};
    normalizedText.split("\n").slice(1).forEach((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
            return;
        }

        const key = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        fields[key] = value;
    });

    const extractedLocation = extractLocationFromText(fields["map url"] || fields["google maps"] || "");
    const coordinates = parseCoordinatesField(fields.coordinates) || extractedLocation?.coordinates || null;
    const address = sanitizeFriendlyValue(fields.address) || extractedLocation?.address || "";

    return {
        type: "kindreturn-item",
        qrId: fields["qr id"] || buildQrId(),
        name: sanitizeFriendlyValue(fields.name),
        address,
        phone: sanitizeFriendlyValue(fields.phone),
        email: sanitizeFriendlyValue(fields.email),
        remarks: sanitizeFriendlyValue(fields.remarks),
        coordinates,
        resolvedAddress: address,
        googleMapsUrl: sanitizeFriendlyValue(fields["map url"] || fields["google maps"]) || buildGoogleMapsLink({
            address,
            coordinates
        }),
        createdAt: sanitizeFriendlyValue(fields["created at"]) || new Date().toISOString(),
        rawText: decodedText
    };
}

function parseCoordinatesField(value) {
    return normalizeCoordinates(parseCoordinatesPair(value));
}

function parseCoordinatesPair(value) {
    if (!value) {
        return null;
    }

    const match = String(value).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) {
        return null;
    }

    return {
        lat: Number(match[1]),
        lng: Number(match[2])
    };
}

function sanitizeFriendlyValue(value) {
    if (!value || /^(not provided|none)$/i.test(value)) {
        return "";
    }
    return value.trim();
}

function buildScanResultMarkup(qrData, rawText) {
    const coordinatesText = formatCoordinates(qrData.coordinates);
    const canOpenMap = Boolean(qrData.address || qrData.coordinates || qrData.googleMapsUrl);
    const details = qrData.type === "kindreturn-item"
        ? `
            <div class="detail-card">
                <div class="detail-card__row">
                    <span class="detail-chip">${escapeHtml(qrData.qrId)}</span>
                    <span class="detail-chip">${escapeHtml(qrData.name || "Unnamed owner")}</span>
                </div>
                <div><strong>Address</strong><p>${escapeHtml(qrData.address || "Not provided")}</p></div>
                ${coordinatesText ? `<div><strong>Coordinates</strong><p>${escapeHtml(coordinatesText)}</p></div>` : ""}
                <div><strong>Phone</strong><p>${escapeHtml(qrData.phone || "Not provided")}</p></div>
                <div><strong>Email</strong><p>${escapeHtml(qrData.email || "Not provided")}</p></div>
                <div><strong>Remarks</strong><p>${escapeHtml(qrData.remarks || "None")}</p></div>
            </div>
        `
        : canOpenMap
            ? `
                <div class="detail-card">
                    <div class="detail-card__row">
                        <span class="detail-chip">Map QR</span>
                        <span class="detail-chip">${escapeHtml(qrData.qrId || "External link")}</span>
                    </div>
                    <div><strong>Address</strong><p>${escapeHtml(qrData.address || "Not provided")}</p></div>
                    ${coordinatesText ? `<div><strong>Coordinates</strong><p>${escapeHtml(coordinatesText)}</p></div>` : ""}
                    <div><strong>Decoded content</strong><p>${escapeHtml(rawText)}</p></div>
                </div>
            `
        : `
            <div class="detail-card">
                <div><strong>Decoded content</strong><p>${escapeHtml(rawText)}</p></div>
            </div>
        `;

    return `
        ${details}
        <div class="result-actions">
            <button class="secondary-btn" type="button" data-action="copy-raw">Copy QR data</button>
            ${qrData.phone ? `<a class="secondary-btn" href="tel:${escapeAttribute(qrData.phone)}">Call owner</a>` : ""}
            ${qrData.email ? `<a class="secondary-btn" href="mailto:${escapeAttribute(qrData.email)}">Email owner</a>` : ""}
            ${canOpenMap ? `<button class="primary-btn" type="button" data-action="open-map">Open map</button>` : ""}
        </div>
    `;
}

function attachResultActionHandlers() {
    refs.scanResultContent.querySelector('[data-action="copy-raw"]')?.addEventListener("click", async () => {
        const copiedText = state.currentQrData?.rawText
            || (state.currentQrData?.type === "kindreturn-item"
                ? serializeQrPayload(state.currentQrData)
                : JSON.stringify(state.currentQrData, null, 2));
        await navigator.clipboard.writeText(copiedText);
        showToast("QR data copied.");
    });

    refs.scanResultContent.querySelector('[data-action="open-map"]')?.addEventListener("click", async () => {
        setActiveSection("maps");
        if (!state.currentLocation) {
            await ensureCurrentLocation(true);
        }
    });
}

// History is stored locally in the browser so the app works without a backend.
async function saveScanHistory(qrData) {
    const record = {
        id: crypto.randomUUID(),
        qrCodeId: qrData.qrId,
        name: qrData.name || "",
        scannedAt: new Date().toISOString(),
        currentLocationAddress: state.currentAddress || "Location unavailable",
        scannerLat: state.currentLocation?.lat ?? null,
        scannerLng: state.currentLocation?.lng ?? null,
        qrPayload: qrData,
        syncStatus: "local"
    };

    state.history.unshift(record);
    state.history = state.history.slice(0, 50);
    saveLocalHistory();
    renderHistory();
    updateHomeStats();
}

function renderHistory() {
    if (!state.history.length) {
        refs.historyList.innerHTML = `<div class="empty-card">No scan history yet. Scan a KindReturn QR to create the first record.</div>`;
        return;
    }

    refs.historyList.innerHTML = state.history.map((record) => `
        <article class="history-item">
            <div class="history-item__top">
                <div>
                    <p class="history-item__title">${escapeHtml(record.name || "Unnamed owner")}</p>
                    <p class="history-item__meta">QR-code ID: ${escapeHtml(record.qrCodeId || "Unknown")}</p>
                    <p class="history-item__meta">Date/time: ${escapeHtml(formatDate(record.scannedAt))}</p>
                </div>
                <span class="detail-chip">${escapeHtml(record.syncStatus || "local")}</span>
            </div>
            <p class="history-item__address">Current location address: ${escapeHtml(record.currentLocationAddress || "Location unavailable")}</p>
            <div class="history-item__actions">
                <button class="secondary-btn" type="button" data-history-map="${record.id}">View map</button>
                <button class="danger-btn" type="button" data-history-delete="${record.id}">Delete</button>
            </div>
        </article>
    `).join("");

    refs.historyList.querySelectorAll("[data-history-map]").forEach((button) => {
        button.addEventListener("click", () => {
            const record = state.history.find((item) => item.id === button.dataset.historyMap);
            if (!record) {
                return;
            }
            state.currentQrData = record.qrPayload;
            updateMapForQrData(record.qrPayload);
            setActiveSection("maps");
        });
    });

    refs.historyList.querySelectorAll("[data-history-delete]").forEach((button) => {
        button.addEventListener("click", () => {
            state.pendingDeleteId = button.dataset.historyDelete;
            refs.deleteModal.classList.remove("is-hidden");
        });
    });
}

function closeDeleteModal() {
    state.pendingDeleteId = null;
    refs.deleteModal.classList.add("is-hidden");
}

async function confirmDeleteHistoryItem() {
    if (!state.pendingDeleteId) {
        closeDeleteModal();
        return;
    }

    const record = state.history.find((item) => item.id === state.pendingDeleteId);
    state.history = state.history.filter((item) => item.id !== state.pendingDeleteId);
    saveLocalHistory();
    renderHistory();
    updateHomeStats();
    closeDeleteModal();

    showToast("History record deleted.");
}

function updateHomeStats() {
    refs.scanCountValue.textContent = String(state.history.length);
}

function renderLatestItem() {
    const item = state.currentQrData || state.history[0]?.qrPayload;
    if (!item) {
        refs.homeLatestCard.textContent = "No QR item has been generated or scanned yet.";
        return;
    }
    const coordinatesText = formatCoordinates(item.coordinates);
    refs.homeLatestCard.innerHTML = `
        <div class="detail-card">
            <div class="detail-card__row">
                <span class="detail-chip">${escapeHtml(item.qrId || "No QR ID")}</span>
                <span class="detail-chip">${escapeHtml(item.name || "Pinned location")}</span>
            </div>
            <div><strong>Address</strong><p>${escapeHtml(item.address || "Not provided")}</p></div>
            ${coordinatesText ? `<div><strong>Coordinates</strong><p>${escapeHtml(coordinatesText)}</p></div>` : ""}
            <div><strong>Phone</strong><p>${escapeHtml(item.phone || "Not provided")}</p></div>
            <div><strong>Email</strong><p>${escapeHtml(item.email || "Not provided")}</p></div>
        </div>
    `;
}

// Download export is rendered separately so the saved PNG stays easy to scan.
function downloadQrCode() {
    if (!state.currentQrData) {
        showToast("Generate a QR code first.");
        return;
    }

    const tempHost = document.createElement("div");
    tempHost.style.position = "fixed";
    tempHost.style.left = "-99999px";
    tempHost.style.top = "-99999px";
    document.body.appendChild(tempHost);

    try {
        new QRCode(tempHost, {
            text: serializeQrPayload(state.currentQrData),
            width: QR_DOWNLOAD_SIZE,
            height: QR_DOWNLOAD_SIZE,
            colorDark: "#2f1b0c",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });

        const sourceCanvas = tempHost.querySelector("canvas");
        const sourceImage = tempHost.querySelector("img");
        const exportCanvas = document.createElement("canvas");
        const exportSize = QR_DOWNLOAD_SIZE + (QR_DOWNLOAD_PADDING * 2);
        exportCanvas.width = exportSize;
        exportCanvas.height = exportSize;

        const ctx = exportCanvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, exportSize, exportSize);

        if (sourceCanvas) {
            ctx.drawImage(sourceCanvas, QR_DOWNLOAD_PADDING, QR_DOWNLOAD_PADDING, QR_DOWNLOAD_SIZE, QR_DOWNLOAD_SIZE);
        } else if (sourceImage) {
            ctx.drawImage(sourceImage, QR_DOWNLOAD_PADDING, QR_DOWNLOAD_PADDING, QR_DOWNLOAD_SIZE, QR_DOWNLOAD_SIZE);
        } else {
            throw new Error("QR export failed.");
        }

        const link = document.createElement("a");
        link.download = buildQrDownloadFilename(state.currentQrData);
        link.href = exportCanvas.toDataURL("image/png");
        link.click();
    } finally {
        document.body.removeChild(tempHost);
    }
}

async function copyCurrentQrPayload() {
    if (!state.currentQrData) {
        showToast("Generate or scan a QR first.");
        return;
    }
    await navigator.clipboard.writeText(serializeQrPayload(state.currentQrData));
    showToast("QR payload copied.");
}

function formatDate(dateString) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(dateString));
}

function formatDuration(totalMinutes) {
    if (totalMinutes < 60) {
        return `${Math.round(totalMinutes)} min`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    return `${hours} hr ${minutes} min`;
}

function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
        refs.toast.classList.remove("is-visible");
    }, 2600);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

function getCoordinateInputValue() {
    const latitudeValue = refs.latitudeInput.value.trim();
    const longitudeValue = refs.longitudeInput.value.trim();

    if (!latitudeValue && !longitudeValue) {
        return { value: null, error: "" };
    }

    if (!latitudeValue || !longitudeValue) {
        return { value: null, error: "Enter both latitude and longitude, or leave both blank." };
    }

    const coordinates = normalizeCoordinates({
        lat: latitudeValue,
        lng: longitudeValue
    });

    if (!coordinates) {
        return { value: null, error: "Coordinates must be valid latitude and longitude values." };
    }

    return { value: coordinates, error: "" };
}

function normalizeCoordinates(coordinates) {
    if (!coordinates) {
        return null;
    }

    const lat = Number(coordinates.lat);
    const lng = Number(coordinates.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    return { lat, lng };
}

function formatCoordinateValue(value) {
    return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

function formatCoordinates(coordinates) {
    const normalizedCoordinates = normalizeCoordinates(coordinates);
    if (!normalizedCoordinates) {
        return "";
    }

    return `${formatCoordinateValue(normalizedCoordinates.lat)}, ${formatCoordinateValue(normalizedCoordinates.lng)}`;
}

function setCoordinateInputs(coordinates, source = "auto") {
    const normalizedCoordinates = normalizeCoordinates(coordinates);
    if (!normalizedCoordinates) {
        clearCoordinateInputs();
        return;
    }

    refs.latitudeInput.value = formatCoordinateValue(normalizedCoordinates.lat);
    refs.longitudeInput.value = formatCoordinateValue(normalizedCoordinates.lng);
    state.coordinateSource = source;
}

function clearCoordinateInputs() {
    refs.latitudeInput.value = "";
    refs.longitudeInput.value = "";
    state.coordinateSource = "empty";
}

function extractQrLocation(payload) {
    if (!payload) {
        return null;
    }

    const locationCandidates = [
        payload.googleMapsUrl,
        payload.rawText,
        payload.remarks
    ];

    for (const candidate of locationCandidates) {
        const parsedLocation = extractLocationFromText(candidate);
        if (parsedLocation?.coordinates || parsedLocation?.address) {
            return parsedLocation;
        }
    }

    return null;
}

function extractLocationFromText(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
        return null;
    }

    const urlLocation = extractLocationFromUrl(normalizedValue);
    if (urlLocation?.coordinates || urlLocation?.address) {
        return urlLocation;
    }

    const coordinates = parseCoordinatesField(normalizedValue);
    if (coordinates) {
        return {
            coordinates,
            address: "",
            url: normalizedValue
        };
    }

    return null;
}

function extractLocationFromUrl(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
        return null;
    }

    if (/^geo:/i.test(normalizedValue)) {
        return extractLocationFromGeoUrl(normalizedValue);
    }

    let url;
    try {
        url = new URL(normalizedValue);
    } catch (error) {
        return null;
    }

    const params = url.searchParams;
    const pairedCoordinates = normalizeCoordinates({
        lat: params.get("lat") || params.get("latitude") || params.get("mlat"),
        lng: params.get("lng") || params.get("lon") || params.get("longitude") || params.get("mlon")
    });

    const candidateValues = [
        pairedCoordinates ? `${pairedCoordinates.lat},${pairedCoordinates.lng}` : "",
        params.get("query"),
        params.get("q"),
        params.get("ll"),
        params.get("sll"),
        params.get("center"),
        params.get("destination"),
        params.get("daddr"),
        params.get("near"),
        params.get("cp"),
        safeDecodeURIComponent(url.hash),
        safeDecodeURIComponent(url.pathname),
        extractHashMapCoordinates(normalizedValue),
        normalizedValue
    ];

    const coordinates = findFirstCoordinateCandidate(candidateValues);
    const address = findFirstAddressCandidate([
        params.get("query"),
        params.get("q"),
        params.get("destination"),
        params.get("daddr")
    ]);

    if (!coordinates && !address) {
        return null;
    }

    if (!coordinates && !isLikelyMapUrl(url)) {
        return null;
    }

    return {
        coordinates,
        address,
        url: normalizedValue
    };
}

function extractLocationFromGeoUrl(value) {
    const normalizedValue = String(value || "").trim();
    const parts = normalizedValue.split("?");
    const coordinateText = parts[0].slice(4);
    const params = new URLSearchParams(parts[1] || "");
    const queryValue = params.get("q") || "";
    const coordinates = parseCoordinatesField(coordinateText) || parseCoordinatesField(queryValue);
    const address = coordinates ? "" : queryValue.trim();

    if (!coordinates && !address) {
        return null;
    }

    return {
        coordinates,
        address,
        url: normalizedValue
    };
}

function extractHashMapCoordinates(value) {
    const match = String(value || "").match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    return match ? `${match[1]},${match[2]}` : "";
}

function findFirstCoordinateCandidate(values) {
    for (const value of values) {
        const coordinates = parseCoordinatesField(value);
        if (coordinates) {
            return coordinates;
        }
    }
    return null;
}

function findFirstAddressCandidate(values) {
    for (const value of values) {
        const candidate = String(value || "").trim();
        if (!candidate) {
            continue;
        }
        if (parseCoordinatesField(candidate)) {
            continue;
        }
        return candidate;
    }
    return "";
}

function isLikelyMapUrl(url) {
    const host = String(url?.hostname || "").toLowerCase();
    const pathname = String(url?.pathname || "").toLowerCase();
    const params = url?.searchParams;

    const knownMapHost = [
        "google.com",
        "maps.google.com",
        "goo.gl",
        "openstreetmap.org",
        "maps.apple.com",
        "waze.com",
        "bing.com",
        "here.com"
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));

    const hasMapPath = /\/maps|\/place|\/dir|\/location|\/search/.test(pathname);
    const hasMapParams = [
        "query",
        "q",
        "ll",
        "sll",
        "center",
        "destination",
        "daddr",
        "lat",
        "lng",
        "lon",
        "latitude",
        "longitude",
        "mlat",
        "mlon",
        "cp"
    ].some((key) => params?.has(key));

    return knownMapHost || hasMapPath || hasMapParams;
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value || "");
    } catch (error) {
        return String(value || "");
    }
}

function parseMapUrlPayload(decodedText) {
    const location = extractLocationFromText(decodedText);
    if (!location?.coordinates && !location?.address) {
        return null;
    }

    return {
        type: "external-qr",
        qrId: "EXTERNAL-QR",
        name: "",
        address: location.address || "",
        phone: "",
        email: "",
        remarks: decodedText,
        coordinates: location.coordinates || null,
        resolvedAddress: location.address || "",
        googleMapsUrl: buildGoogleMapsLink({
            address: location.address || "",
            coordinates: location.coordinates || null
        }) || location.url || "",
        createdAt: new Date().toISOString(),
        rawText: decodedText
    };
}
