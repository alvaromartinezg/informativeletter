/* =========================================================
   map.js
   Visor Leaflet para KMZ/KML con fondo satelital
   Requisitos globales que luego pondremos en el HTML:
   - Leaflet (window.L)
   - JSZip (window.JSZip)
   - toGeoJSON (window.toGeoJSON)
   - Un contenedor <div id="map"></div>
   - Un input file con id="file" (ya lo tienes)
   ========================================================= */

(function () {
  "use strict";

  // -----------------------------
  // Estado global del visor
  // -----------------------------
  let map = null;
  let satelliteLayer = null;
  let labelsLayer = null;
  let uploadedLayer = null;
  let layerControl = null;

  // -----------------------------
  // Configuración
  // -----------------------------
  const CONFIG = {
    mapId: "map",
    mainFileInputId: "file",
    fallbackCenter: [-12.0464, -77.0428], // Lima
    fallbackZoom: 6,
    maxFileSizeMB: 100,
    fitPadding: [20, 20]
  };

  // -----------------------------
  // Utilidades generales
  // -----------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function logInfo(...args) {
    console.log("[map.js]", ...args);
  }

  function logWarn(...args) {
    console.warn("[map.js]", ...args);
  }

  function logError(...args) {
    console.error("[map.js]", ...args);
  }

  function setStatusText(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  function appendLog(msg) {
    const el = $("log");
    if (!el) return;
    el.style.display = "block";
    el.textContent += (el.textContent ? "\n" : "") + msg;
  }

  function clearLog() {
    const el = $("log");
    if (!el) return;
    el.textContent = "";
  }

  function bytesToMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // -----------------------------
  // Validaciones de librerías
  // -----------------------------
  function checkDependencies() {
    const missing = [];

    if (typeof window.L === "undefined") missing.push("Leaflet");
    if (typeof window.JSZip === "undefined") missing.push("JSZip");
    if (typeof window.toGeoJSON === "undefined") missing.push("toGeoJSON");

    if (missing.length) {
      const msg = `Faltan librerías para el visor: ${missing.join(", ")}`;
      logError(msg);
      setStatusText(msg);
      appendLog(msg);
      return false;
    }

    return true;
  }

  // -----------------------------
  // Inicialización del mapa
  // -----------------------------
  function initMap() {
    if (!checkDependencies()) return;
    if (map) return;

    const mapEl = $(CONFIG.mapId);
    if (!mapEl) {
      logWarn(`No existe el contenedor #${CONFIG.mapId}. El visor no se inicializó aún.`);
      return;
    }

    map = L.map(CONFIG.mapId, {
      zoomControl: true,
      attributionControl: true
    }).setView(CONFIG.fallbackCenter, CONFIG.fallbackZoom);

    // Fondo satelital ESRI
    satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 22,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    );

    // Etiquetas para complementar el satélite
    labelsLayer = L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 22,
        attribution: "&copy; Esri"
      }
    );

    satelliteLayer.addTo(map);
    labelsLayer.addTo(map);

    layerControl = L.control.layers(
      {
        "Satélite": satelliteLayer,
        "Etiquetas": labelsLayer
      },
      {},
      { collapsed: true }
    ).addTo(map);

    addCustomMapButtons();

    logInfo("Mapa inicializado correctamente.");
    setStatusText("Visor listo. Puedes cargar un archivo KMZ/KML.");
  }

  // -----------------------------
  // Botones personalizados
  // -----------------------------
  function addCustomMapButtons() {
    if (!map) return;

    const ClearControl = L.Control.extend({
      options: { position: "topleft" },

      onAdd: function () {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        container.style.background = "#fff";
        container.style.cursor = "pointer";
        container.style.width = "34px";
        container.style.height = "34px";
        container.style.lineHeight = "34px";
        container.style.textAlign = "center";
        container.style.fontWeight = "bold";
        container.title = "Limpiar capa cargada";
        container.innerHTML = "✕";

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, "click", function () {
          clearUploadedLayer();
          setStatusText("Capa limpiada.");
          appendLog("Se eliminó la capa cargada del mapa.");
        });

        return container;
      }
    });

    map.addControl(new ClearControl());
  }

  // -----------------------------
  // Limpieza de capa cargada
  // -----------------------------
  function clearUploadedLayer() {
    if (!map) return;

    if (uploadedLayer) {
      map.removeLayer(uploadedLayer);

      if (layerControl) {
        try {
          layerControl.removeLayer(uploadedLayer);
        } catch (e) {
          // No crítico
        }
      }

      uploadedLayer = null;
    }
  }

  // -----------------------------
  // Helpers de tipo / color
  // -----------------------------
  function detectFeatureType(properties = {}, geometryType = "") {
    const raw = [
      properties.name,
      properties.description,
      properties.styleUrl,
      properties.stroke,
      properties.fill
    ]
      .filter(Boolean)
      .join(" | ")
      .toLowerCase();

    const isPolygon =
      geometryType.includes("Polygon") ||
      geometryType.includes("MultiPolygon");

    if (isPolygon) return "polygon";

    if (
      raw.includes("canaliz") ||
      raw.includes("duct") ||
      raw.includes("subterr") ||
      raw.includes("underground")
    ) {
      return "canalizado";
    }

    if (
      raw.includes("aereo") ||
      raw.includes("aéreo") ||
      raw.includes("poste") ||
      raw.includes("postes") ||
      raw.includes("adss") ||
      raw.includes("media tension") ||
      raw.includes("mt")
    ) {
      return "aereo";
    }

    return "general";
  }

  function getFeatureStyle(feature) {
    const props = feature?.properties || {};
    const geometryType = feature?.geometry?.type || "";
    const featureType = detectFeatureType(props, geometryType);

    // Colores solicitados:
    // aéreo = azul
    // canalizado = verde
    // polígono = fucsia
    let color = "#3388ff";
    let fillColor = "#3388ff";
    let weight = 4;
    let fillOpacity = 0.18;

    if (featureType === "canalizado") {
      color = "#00a651";
      fillColor = "#00a651";
    } else if (featureType === "polygon") {
      color = "#ff00ff";
      fillColor = "#ff00ff";
      weight = 3;
      fillOpacity = 0.22;
    } else if (featureType === "aereo") {
      color = "#0066ff";
      fillColor = "#0066ff";
    }

    return {
      color,
      weight,
      opacity: 0.95,
      fillColor,
      fillOpacity
    };
  }

  function createPointMarker(feature, latlng) {
    const style = getFeatureStyle(feature);
    return L.circleMarker(latlng, {
      radius: 6,
      color: style.color,
      weight: 2,
      opacity: 1,
      fillColor: style.fillColor,
      fillOpacity: 0.9
    });
  }

  // -----------------------------
  // Popup
  // -----------------------------
  function buildPopupHtml(feature) {
    const props = feature?.properties || {};
    const geometryType = feature?.geometry?.type || "";
    const featureType = detectFeatureType(props, geometryType);

    const rows = [];

    if (props.name) {
      rows.push(`
        <tr>
          <td style="padding:4px 8px;"><b>Nombre</b></td>
          <td style="padding:4px 8px;">${escapeHtml(props.name)}</td>
        </tr>
      `);
    }

    rows.push(`
      <tr>
        <td style="padding:4px 8px;"><b>Tipo</b></td>
        <td style="padding:4px 8px;">${escapeHtml(featureType)}</td>
      </tr>
    `);

    rows.push(`
      <tr>
        <td style="padding:4px 8px;"><b>Geometría</b></td>
        <td style="padding:4px 8px;">${escapeHtml(geometryType || "No definida")}</td>
      </tr>
    `);

    if (props.description) {
      rows.push(`
        <tr>
          <td style="padding:4px 8px; vertical-align:top;"><b>Descripción</b></td>
          <td style="padding:4px 8px; max-width:280px; word-break:break-word;">
            ${escapeHtml(stripHtml(props.description))}
          </td>
        </tr>
      `);
    }

    // Mostrar otras propiedades útiles
    const excluded = new Set(["name", "description"]);
    Object.keys(props).forEach((key) => {
      if (excluded.has(key)) return;
      const value = props[key];
      if (value == null || value === "") return;
      if (typeof value === "object") return;

      rows.push(`
        <tr>
          <td style="padding:4px 8px;"><b>${escapeHtml(key)}</b></td>
          <td style="padding:4px 8px;">${escapeHtml(value)}</td>
        </tr>
      `);
    });

    return `
      <div style="font-size:13px; min-width:220px;">
        <div style="font-weight:700; margin-bottom:8px;">Elemento KMZ/KML</div>
        <table style="border-collapse:collapse; width:100%;">
          ${rows.join("")}
        </table>
      </div>
    `;
  }

  function stripHtml(value) {
    const temp = document.createElement("div");
    temp.innerHTML = value;
    return temp.textContent || temp.innerText || "";
  }

  // -----------------------------
  // Conversión KML -> GeoJSON
  // -----------------------------
  function parseKmlTextToGeoJson(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, "text/xml");

    const parserError = xml.querySelector("parsererror");
    if (parserError) {
      throw new Error("El KML no pudo ser interpretado correctamente.");
    }

    const geojson = window.toGeoJSON.kml(xml);
    if (!geojson || !geojson.features || !geojson.features.length) {
      throw new Error("No se encontraron geometrías válidas en el KML.");
    }

    return geojson;
  }

  // -----------------------------
  // KMZ -> KML
  // -----------------------------
  async function extractKmlTextFromKmz(file) {
    const zip = await window.JSZip.loadAsync(file);

    // Buscar primero doc.kml
    let kmlEntry = zip.file(/doc\.kml$/i)[0];

    // Si no existe doc.kml, buscar cualquier .kml
    if (!kmlEntry) {
      const allKml = zip.file(/\.kml$/i);
      if (allKml.length > 0) {
        kmlEntry = allKml[0];
      }
    }

    if (!kmlEntry) {
      throw new Error("El KMZ no contiene un archivo KML interno.");
    }

    return await kmlEntry.async("text");
  }

  // -----------------------------
  // Render GeoJSON
  // -----------------------------
  function renderGeoJson(geojson, layerName = "KMZ/KML cargado") {
    if (!map) initMap();
    if (!map) throw new Error("No fue posible inicializar el mapa.");

    clearUploadedLayer();

    uploadedLayer = L.geoJSON(geojson, {
      style: function (feature) {
        return getFeatureStyle(feature);
      },
      pointToLayer: function (feature, latlng) {
        return createPointMarker(feature, latlng);
      },
      onEachFeature: function (feature, layer) {
        layer.bindPopup(buildPopupHtml(feature));
      }
    });

    uploadedLayer.addTo(map);

    if (layerControl) {
      layerControl.addOverlay(uploadedLayer, layerName);
    }

    const bounds = uploadedLayer.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: CONFIG.fitPadding });
    } else {
      map.setView(CONFIG.fallbackCenter, CONFIG.fallbackZoom);
    }

    setStatusText(`Capa cargada correctamente: ${layerName}`);
    appendLog(`Se dibujó en el mapa la capa: ${layerName}`);
  }

  // -----------------------------
  // Cargar archivo KMZ/KML
  // -----------------------------
  async function loadFileToMap(file) {
    if (!file) {
      throw new Error("No se recibió ningún archivo.");
    }

    const fileName = file.name || "archivo";
    const lowerName = fileName.toLowerCase();

    const maxBytes = CONFIG.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(
        `El archivo pesa ${bytesToMB(file.size)} MB y supera el límite configurado de ${CONFIG.maxFileSizeMB} MB.`
      );
    }

    setStatusText(`Leyendo archivo: ${fileName}`);
    appendLog(`Archivo recibido: ${fileName} (${bytesToMB(file.size)} MB)`);

    let geojson;

    if (lowerName.endsWith(".kmz")) {
      appendLog("Detectado formato KMZ. Extrayendo KML interno...");
      const kmlText = await extractKmlTextFromKmz(file);
      geojson = parseKmlTextToGeoJson(kmlText);
    } else if (lowerName.endsWith(".kml")) {
      appendLog("Detectado formato KML. Interpretando contenido...");
      const kmlText = await file.text();
      geojson = parseKmlTextToGeoJson(kmlText);
    } else {
      throw new Error("Formato no soportado. Solo se permite KMZ o KML.");
    }

    renderGeoJson(geojson, fileName);
  }

  // -----------------------------
  // Enlace automático con input #file
  // -----------------------------
  function bindMainFileInput() {
    const input = $(CONFIG.mainFileInputId);
    if (!input) {
      logWarn(`No se encontró el input #${CONFIG.mainFileInputId}.`);
      return;
    }

    input.addEventListener("change", async function (ev) {
      const file = ev.target?.files?.[0];
      if (!file) return;

      clearLog();

      try {
        initMap();
        await loadFileToMap(file);
      } catch (error) {
        logError(error);
        setStatusText(`Error al cargar archivo: ${error.message}`);
        appendLog(`ERROR: ${error.message}`);
      }
    });
  }

  // -----------------------------
  // API pública opcional
  // -----------------------------
  window.BitelKmzMap = {
    init: initMap,
    clear: clearUploadedLayer,
    loadFile: loadFileToMap,
    renderGeoJson: renderGeoJson
  };

  // -----------------------------
  // Inicio automático
  // -----------------------------
  document.addEventListener("DOMContentLoaded", function () {
    try {
      initMap();
      bindMainFileInput();
    } catch (error) {
      logError("No se pudo iniciar el visor:", error);
      setStatusText(`Error al iniciar visor: ${error.message}`);
      appendLog(`ERROR DE INICIO: ${error.message}`);
    }
  });
})();
