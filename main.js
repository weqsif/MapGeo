import * as pmtiles from "pmtiles";
import * as maplibregl from "maplibre-gl";
import layers from "protomaps-themes-base";
import * as turf from '@turf/turf';


const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const myMap = new maplibregl.Map({
  container: "map", // container id
  style: {
    version: 8,
    glyphs: "https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${location.protocol}//${location.host}${location.pathname}hmb.pmtiles`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: layers("protomaps", "light"),
  },
  zoom: 12, // Установка масштаба по умолчанию
});

let stations = new Map();
let rssiData = new Map();
let deviceColors = new Map(); // Мапа для хранения цветов устройств
let existingCircles = new Set(); // Множество для хранения идентификаторов станций с существующими окружностями
let intersectionMarkers = new Map(); // Мапа для хранения маркеров пересечения
let intersectionCircleSource = null; // Глобальная переменная для хранения источника данных полигона пересечения
let deviceCircles = new Map(); // Мапа для хранения окружностей для каждого устройства
let stationCircles = new Map(); // Мапа для хранения окружностей для каждой станции
let deviceList = new Set(); // Множество для хранения deviceid
let checkboxStates = {}; // Объект для хранения состояния чекбоксов
// Состояние чекбокса "All"
let allCheckboxState = false; // false - выключен, true - включен
// Объект для хранения состояния видимости слоев
const layerVisibilityStates = {};
const deviceFlags = {};
let itemVisibilityStates = {}; // Объект для хранения состояния отображения каждого элемента списка
let geomarkFeaturesGlobal = []; // Глобальная переменная для хранения geomarkFeatures
const trackingStates = {}; // Объект для хранения состояния трекинга для каждого устройства
let allServerData = [];

// Координаты полигона
const polygonCoordinates = [
  [
    [48.723369118563255, 55.75619106229897], // Вершина 1
    [48.722813901297165, 55.7560564458412], // Вершина 2
    [48.723248419157585, 55.75558755341253], // Вершина 3
    [48.72345763146074, 55.75563595547364], // Вершина 4
    [48.723369118563255, 55.75619106229897], // Вершина 1 (замыкаем полигон)
  ],
];

// Создаем полигон с помощью Turf.js
const area = turf.polygon(polygonCoordinates);


// Функция для вычисления расстояния до точки с помощью rssi
function calculateDistance(rssi) {
  const N = 2.6; // фактор среды
  const measuredPower = -5; // уровень rssi на один метр 
  const distance = Math.pow(10, (measuredPower - rssi) / (10 * N)); // Расстояние в метрах
  return distance;
}

function getDeviceColor(deviceid) {
  if (!deviceColors.has(deviceid)) {
    const color = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
    deviceColors.set(deviceid, color);
  }
  return deviceColors.get(deviceid);
}

function updateTotalDevicesCount() {
  const totalCountElement = document.getElementById('total-count');
  if (totalCountElement) {
    totalCountElement.textContent = deviceList.size; // Обновляем количество устройств
  }
}

function updateDeviceList() {
  const deviceListElement = document.getElementById('device-list');
  deviceListElement.innerHTML = ''; // Очищаем список

  // Инициализация объекта checkboxStates
  deviceList.forEach(deviceid => {
    if (!checkboxStates[deviceid]) {
      checkboxStates[deviceid] = false; // Устанавливаем состояние по умолчанию как false
    }

    // Инициализация trackingStates для каждого устройства
    if (!trackingStates[deviceid]) {
      trackingStates[deviceid] = false; // Устанавливаем состояние трекинга по умолчанию как false
    }
  });

  // Добавляем чекбокс "All"
  const allCheckbox = document.createElement('input');
  allCheckbox.type = 'checkbox';
  allCheckbox.id = 'all-checkbox';
  allCheckbox.checked = allCheckboxState;
  allCheckbox.indeterminate = false; // Сбрасываем состояние "частично включен"

  // Обработчик события для чекбокса "All"
  allCheckbox.addEventListener('change', () => {
    const visible = allCheckbox.checked;
    toggleAllDevicesVisibility(visible);
    updateAllCheckboxState(); // Обновляем состояние чекбокса "All" сразу
  });

  const allLabel = document.createElement('label');
  allLabel.htmlFor = 'all-checkbox';
  allLabel.innerText = 'All';

  const allLi = document.createElement('li');
  allLi.id = 'all-checkbox-li'; // Уникальный ID для элемента "All"
  allLi.appendChild(allCheckbox);
  allLi.appendChild(allLabel);
  deviceListElement.appendChild(allLi);

  // Добавляем чекбоксы для каждого устройства
  deviceList.forEach(deviceid => {
    const li = document.createElement('li');
    const color = deviceColors.get(deviceid); // Получаем цвет устройства
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = deviceid; // Устанавливаем значение чекбокса

    // Восстанавливаем состояние чекбокса из объекта checkboxStates
    checkbox.checked = checkboxStates[deviceid] !== false;

    // Обработчик события для чекбокса устройства
    checkbox.addEventListener('change', () => {
      toggleDeviceVisibility(deviceid, checkbox.checked);
      updateAllCheckboxState(); // Обновляем состояние чекбокса "All"

      // Сохраняем состояние чекбокса в объекте checkboxStates
      checkboxStates[deviceid] = checkbox.checked;
    });

    // Создаем HTML-строку для устройства
    li.innerHTML = `
      <span style="color: ${color};">■</span> Device ID: ${deviceid}
    `;
    li.appendChild(checkbox);

    // Добавляем иконку глаза (👁) для трекинга
    const eyeIcon = document.createElement('span');
    eyeIcon.className = 'eye-icon';
    eyeIcon.innerText = ' 👁';
    eyeIcon.style.cursor = 'pointer';
    eyeIcon.style.color = trackingStates[deviceid] ? 'red' : ''; // Устанавливаем цвет иконки

    // Обработчик события для иконки глаза
    eyeIcon.addEventListener('click', () => {
      toggleTracking(deviceid);
    });

    li.appendChild(eyeIcon);

    // Проверяем, является ли устройство новым
    if (deviceFlags[deviceid]) {
      // Добавляем надпись "New!"
      const newLabel = document.createElement('span');
      newLabel.innerText = ' New!';
      newLabel.style.color = 'red';
      li.appendChild(newLabel); // Добавляем надпись в элемент <li>

      // Удаляем надпись "New!" через 4 секунды
      setTimeout(() => {
        newLabel.classList.add('fade-out'); // Добавляем класс для анимации
        deviceFlags[deviceid] = false;
      }, 4000);
    }

    deviceListElement.appendChild(li); // Добавляем элемент <li> в список
  });

  // Добавляем строку "Total: " в конец списка
  const totalDevicesLi = document.createElement('li');
  totalDevicesLi.innerHTML = `Total: <span id="total-count">${deviceList.size}</span>`;
  deviceListElement.appendChild(totalDevicesLi);

  // Обновляем состояние чекбокса "All" после добавления всех чекбоксов
  updateAllCheckboxState();
}

function updateAllCheckboxState() {
  const allCheckbox = document.getElementById('all-checkbox');
  if (!allCheckbox) return;

  const deviceCheckboxes = Array.from(document.querySelectorAll('#device-list input[type="checkbox"]:not(#all-checkbox)'));

  // Проверяем состояние всех чекбоксов устройств
  const allChecked = deviceCheckboxes.every(checkbox => checkbox.checked);
  const someChecked = deviceCheckboxes.some(checkbox => checkbox.checked);

  if (allChecked) {
    // Все чекбоксы включены
    allCheckbox.checked = true;
    allCheckbox.indeterminate = false; // Сбрасываем состояние "частично включен"
  } else if (someChecked) {
    // Некоторые чекбоксы включены
    allCheckbox.checked = true;
    allCheckbox.indeterminate = true; // Устанавливаем состояние "частично включен"
  } else {
    // Все чекбоксы выключены
    allCheckbox.checked = false;
    allCheckbox.indeterminate = false; // Сбрасываем состояние "частично включен"
  }
}

function toggleDeviceVisibility(deviceid, visible) {
  // Устанавливаем видимость для всех слоев устройства
  const layerIds = Array.from(myMap.getStyle().layers)
    .filter(layer => layer.id.startsWith(`circles-layer-${deviceid}`))
    .map(layer => layer.id);

  layerIds.forEach(layerId => {
    myMap.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    layerVisibilityStates[layerId] = visible;
  });

  // Сохраняем состояние чекбокса устройства
  checkboxStates[deviceid] = visible;

  // Обновляем состояние чекбокса "All"
  updateAllCheckboxState();
}

function toggleAllDevicesVisibility(visible) {
  deviceList.forEach(deviceid => {
    // Обновляем состояние чекбоксов устройств
    const checkbox = document.querySelector(`#device-list input[type="checkbox"][value="${deviceid}"]`);
    if (checkbox) {
      checkbox.checked = visible;
      toggleDeviceVisibility(deviceid, visible);
    }
  });

  // Обновляем состояние чекбокса "All"
  const allCheckbox = document.getElementById('all-checkbox');
  if (allCheckbox) {
    allCheckbox.checked = visible;
    allCheckbox.indeterminate = false;
  }

  // Сохраняем состояние чекбоксов устройств
  deviceList.forEach(deviceid => {
    checkboxStates[deviceid] = visible;
  });

  // Обновляем состояние чекбокса "All"
  allCheckboxState = visible;
}

function toggleTracking(deviceid) {
  // Проверяем, включено ли уже отслеживание для этого устройства
  const isTrackingEnabled = trackingStates[deviceid];

  if (isTrackingEnabled) {
    // Если отслеживание уже включено, выключаем его
    trackingStates[deviceid] = false;
    clearTracking(deviceid); // Удаляем точки пересечения для этого устройства
  } else {
    // Если отслеживание выключено, включаем его
    trackingStates[deviceid] = true;

    // Очищаем треки для всех других устройств
    deviceList.forEach(otherDeviceId => {
      if (otherDeviceId !== deviceid && trackingStates[otherDeviceId]) {
        clearTracking(otherDeviceId);
        trackingStates[otherDeviceId] = false;
      }
    });

    // Отображаем точки пересечения для выбранного устройства
    showTrackingHistory(allServerData, deviceid);
  }

  // Обновляем состояние иконки глаза
  updateEyeIconState();
}

function updateEyeIconState() {
  deviceList.forEach(deviceid => {
    const eyeIcon = document.querySelector(`#device-list li:has([value="${deviceid}"]) .eye-icon`);
    if (eyeIcon) {
      eyeIcon.style.color = trackingStates[deviceid] ? 'red' : '';
    }
  });
}

function formatTimestamp(timestamp) {
  // Удаляем часть строки с миллисекундами и заменяем 'T' на пробел
  return timestamp.replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function showTrackingHistory(allServerData, deviceid = null) {
  console.log("Данные, переданные в showTrackingHistory (allServerData):", allServerData);

  // Если deviceid указан, фильтруем данные только для этого устройства
  const filteredFeatures = deviceid
    ? allServerData.filter(feature => {
        const featureDeviceId = feature.deviceid.toString(); // Приводим к строке
        const match = featureDeviceId === deviceid.toString(); // Приводим к строке
        if (!match) {
          console.log(`Исключенная запись: deviceid=${feature.deviceid}, ожидаемый deviceid=${deviceid}`);
        }
        return match;
      })
    : allServerData;

  console.log("Отфильтрованные данные для устройства:", filteredFeatures);

  // Группируем данные по времени (timestamp)
  const groupedByTime = filteredFeatures.reduce((acc, feature) => {
    const timestamp = feature.timestamp; // Преобразуем временную метку
    if (!acc[timestamp]) {
      acc[timestamp] = [];
    }
    acc[timestamp].push(feature);
    return acc;
  }, {});

  console.log("Данные, сгруппированные по времени:", groupedByTime);

  // Получаем массив временных меток, отсортированный по времени
  const timestamps = Object.keys(groupedByTime).sort();

  console.log("Временные метки:", timestamps);

  // Игнорируем последнюю запись (текущее местоположение), только если меток больше одной
  const previousTimestamps = timestamps.length > 1 ? timestamps.slice(0, -1) : [];

  console.log("Предыдущие временные метки (исключая последнюю):", previousTimestamps);

  // Очищаем старые источники и слои для данного устройства
  clearOldSourcesAndLayers(deviceid);

  // Массив для хранения координат точек пересечения
  const lineCoordinates = [];

  // Обрабатываем каждую предыдущую временную метку
  previousTimestamps.forEach(timestamp => {
    const features = groupedByTime[timestamp];

    console.log(`Данные для временной метки ${timestamp}:`, features);

    // Создаем массив полигонов для данного набора данных
    const polygons = features.map(feature => {
      const stationid = feature.stationid;
      const rssi = feature.rssi;
      const distance = calculateDistance(rssi); // Вычисляем расстояние на основе RSSI

      console.log(`Построение полигона для станции ${stationid} с RSSI ${rssi} и расстоянием ${distance}`);

      // Получаем координаты станции
      const station = stations.get(stationid);
      if (!station) {
        console.warn(`Станция с id ${stationid} не найдена`);
        return null;
      }

      const stationCoordinates = station.getLngLat();

      console.log(`Координаты станции ${stationid}:`, stationCoordinates);

      // Создаем полигон с использованием turf.js
      const polygon = turf.buffer(turf.point([stationCoordinates.lng, stationCoordinates.lat]), distance, { units: 'meters' });

      return polygon;
    }).filter(polygon => polygon !== null); // Убираем null значения

    console.log(`Полигоны для временной метки ${timestamp}:`, polygons);

    if (polygons.length === 0) {
      console.warn(`Не удалось построить полигоны для устройства ${deviceid} на момент ${timestamp}`);
      return;
    }

    // Добавляем каждый полигон на карту
    polygons.forEach((polygon, index) => {
      const polygonSourceId = `polygon-source-${deviceid}-${timestamp}-${index}`;

      // Проверяем, существует ли источник
      if (myMap.getSource(polygonSourceId)) {
        myMap.removeSource(polygonSourceId); // Удаляем старый источник
      }

      myMap.addSource(polygonSourceId, {
        type: "geojson",
        data: polygon,
      });

      // Добавляем слой для отображения полигона
      myMap.addLayer({
        id: `polygon-layer-${deviceid}-${timestamp}-${index}`,
        type: "fill",
        source: polygonSourceId,
        paint: {
          "fill-color": "blue", // Цвет полигона
          "fill-opacity": 0.3, // Прозрачность полигона
        },
      });

      // Устанавливаем видимость слоя (всегда видимый)
      myMap.setLayoutProperty(`polygon-layer-${deviceid}-${timestamp}-${index}`, 'visibility', 'none');
    });

    // Находим пересечение полигонов с использованием вашей функции
    const polygonsData = {
      type: "FeatureCollection",
      features: polygons,
    };

    const intersection = findIntersectionOfPolygons(polygonsData);

    if (intersection) {
      // Получаем центр пересечения
      const centroid = turf.centroid(intersection);
      const coordinates = centroid.geometry.coordinates;

      console.log(`Точка пересечения для временной метки ${timestamp}:`, coordinates);

      // Сохраняем координаты точки пересечения
      lineCoordinates.push(coordinates);

      // Создаем источник данных для точки пересечения
      const intersectionSourceId = `intersection-source-${deviceid}-${timestamp}`;

      // Проверяем, существует ли источник
      if (myMap.getSource(intersectionSourceId)) {
        myMap.removeSource(intersectionSourceId); // Удаляем старый источник
      }

      myMap.addSource(intersectionSourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                deviceid: deviceid,
                timestamp: timestamp,
              },
              geometry: {
                type: "Point",
                coordinates: coordinates,
              },
            },
          ],
        },
      });

      // Добавляем слой для отображения точки пересечения
      myMap.addLayer({
        id: `intersection-layer-${deviceid}-${timestamp}`,
        type: "circle",
        source: intersectionSourceId,
        paint: {
          "circle-radius": 6, // Основной радиус круга
          "circle-color": "red", // Цвет креста
          "circle-stroke-color": "black", // Черная граница
          "circle-stroke-width": 2, // Толщина границы
        },
      });

      // Устанавливаем видимость слоя (всегда видимый)
      myMap.setLayoutProperty(`intersection-layer-${deviceid}-${timestamp}`, 'visibility', 'visible');

      // Добавляем обработчик события клика для точки пересечения
      myMap.on('click', `intersection-layer-${deviceid}-${timestamp}`, (e) => {
        const feature = e.features[0];
        if (feature && feature.properties && feature.properties.deviceid) {
          const deviceid = feature.properties.deviceid;
          const timestamp = feature.properties.timestamp;

          const formattedTimestamp = formatTimestamp(timestamp);

          // Создаем всплывающее окно с информацией о deviceid и timestamp
          const popupContent = `
            <strong>Device ID:</strong> ${deviceid}<br>
            <strong>Timestamp:</strong> ${formattedTimestamp}<br>
          `;

          const popup = new maplibregl.Popup()
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(myMap);
        }
      });
    }
  });

  // Добавляем пунктирную линию между точками пересечения
  if (lineCoordinates.length > 1) {
    const lineSourceId = `line-source-${deviceid}`;

    // Проверяем, существует ли источник
    if (myMap.getSource(lineSourceId)) {
      myMap.removeSource(lineSourceId); // Удаляем старый источник
    }

    myMap.addSource(lineSourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: lineCoordinates,
        },
      },
    });

    // Добавляем слой для отображения линии
    myMap.addLayer({
      id: `line-layer-${deviceid}`,
      type: "line",
      source: lineSourceId,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "black",
        "line-width": 2,
        "line-dasharray": [2, 2], // Пунктирная линия
      },
    });
  }
}

function clearOldSourcesAndLayers(deviceid) {
  // Удаляем все слои, связанные с устройством
  myMap.getStyle().layers.forEach(layer => {
    if (layer.id.startsWith(`polygon-layer-${deviceid}`) || 
        layer.id.startsWith(`intersection-layer-${deviceid}`) ||
        layer.id.startsWith(`line-layer-${deviceid}`)) { // Добавляем проверку для линии
      myMap.removeLayer(layer.id); // Удаляем слой
    }
  });

  // Удаляем все источники данных, связанные с устройством
  const sources = myMap.getStyle().sources;
  if (sources && typeof sources === 'object') {
    Object.keys(sources).forEach(sourceId => {
      if (sourceId.startsWith(`polygon-source-${deviceid}`) || 
          sourceId.startsWith(`intersection-source-${deviceid}`) ||
          sourceId.startsWith(`line-source-${deviceid}`)) { // Добавляем проверку для линии
        myMap.removeSource(sourceId); // Удаляем источник
      }
    });
  }
}

function clearTracking(deviceid) {
  // Удаляем все слои, связанные с устройством
  myMap.getStyle().layers.forEach(layer => {
    if (layer.id.startsWith(`intersection-layer-${deviceid}`) ||
        layer.id.startsWith(`line-layer-${deviceid}`)) { // Добавляем проверку для линии
      myMap.removeLayer(layer.id);
    }
  });

  // Удаляем все источники данных, связанные с устройством
  const sources = myMap.getStyle().sources;
  if (sources && typeof sources === 'object') {
    Object.keys(sources).forEach(sourceId => {
      if (sourceId.startsWith(`intersection-source-${deviceid}`) ||
          sourceId.startsWith(`line-source-${deviceid}`)) { // Добавляем проверку для линии
        myMap.removeSource(sourceId);
      }
    });
  }
}

function getTrackingHistory(deviceid) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 час назад

  // Фильтруем данные по deviceid и timestamp
  const trackingHistory = geomarkFeatures.filter(feature => {
    const featureTimestamp = new Date(feature.properties.timestamp);
    return feature.properties.deviceid === deviceid && featureTimestamp >= oneHourAgo && featureTimestamp <= now;
  });

  // Преобразуем данные в формат GeoJSON
  return trackingHistory.map(feature => ({
    type: "Feature",
    properties: {
      deviceid: feature.properties.deviceid,
      stationid: feature.properties.stationid,
      rssi: feature.properties.rssi,
    },
    geometry: {
      type: "Point",
      coordinates: feature.geometry.coordinates,
    },
  }));
}

function createCustomMarker(imageUrl) {
  const el = document.createElement('div');
  el.style.backgroundImage = `url(${imageUrl})`;
  el.style.width = '36px';
  el.style.height = '40px';
  el.style.backgroundSize = 'cover';
  el.style.cursor = 'pointer';
  return el;
}

function animatePulsingCircle(layerId, color) {
  const duration = 3000; // Длительность цикла анимации (3 секунды)
  const t = (performance.now() % duration) / duration;

  // Радиус пульсирующей области
  const minRadius = 1; // Минимальный радиус
  const maxRadius = 20; // Максимальный радиус
  const radius = minRadius + (maxRadius - minRadius) * Math.abs(Math.sin(t * Math.PI * 2)); // Радиус колеблется от minRadius до maxRadius

  // Прозрачность пульсирующей области
  let opacity = 0.5 * (1 - t); // Прозрачность уменьшается от 0.5 до 0

  // Если радиус достиг максимума, прозрачность становится 0
  if (radius >= maxRadius) {
    opacity = 0;
  }

  // Проверяем, существует ли слой перед изменением стиля
  if (myMap.getLayer(layerId)) {
    // Обновляем свойства слоя
    myMap.setPaintProperty(layerId, "circle-radius", radius);
    myMap.setPaintProperty(layerId, "circle-opacity", opacity);
  }

  // Продолжаем анимацию
  requestAnimationFrame(() => animatePulsingCircle(layerId, color));
}

myMap.on("load", () => {

  // Добавляем источник данных для полигона
  myMap.addSource("polygon-source", {
    type: "geojson",
    data: area,
  });

  // Добавляем слой для отображения полигона
  myMap.addLayer({
    id: "polygon-layer",
    type: "fill", // Тип слоя для заливки полигона
    source: "polygon-source",
    paint: {
      "fill-color": "#0000FF", // Цвет заливки
      "fill-opacity": 0.3, // Прозрачность заливки
    },
  });

  // Добавляем слой для отображения границы полигона
  myMap.addLayer({
    id: "polygon-outline-layer",
    type: "line", // Тип слоя для границы
    source: "polygon-source",
    paint: {
      "line-color": "#FFFFFF", // Цвет границы
      "line-width": 2, // Толщина границы
    },
  });
  
  const minLon = 48.704023; // Минимальная долгота
  const maxLon = 48.781786; // Максимальная долгота
  const minLat = 55.736341;  // Минимальная широта
  const maxLat = 55.766193;  // Максимальная широта

  // Определяем границы вашей области
  const bounds = [minLon, minLat, maxLon, maxLat];

  // Устанавливаем максимальные границы карты
  myMap.setMaxBounds(bounds);

  // Добавляем источник данных из OpenStreetMap
  myMap.addSource('osm-buildings', {
    type: 'vector',
    url: 'https://api.maptiler.com/tiles/v3/tiles.json?key=TIRssdxNyhmmsolYLLGY'
});

// Добавляем слой для 3D-зданий
myMap.addLayer({
    id: '3d-buildings',
    type: 'fill-extrusion',
    source: 'osm-buildings',
    'source-layer': 'building', // Указываем слой с данными о зданиях
    paint: {
        'fill-extrusion-color': '#aaa', // Цвет зданий
        'fill-extrusion-height': ['get', 'render_height'], // Высота зданий
        'fill-extrusion-base': ['get', 'render_min_height'], // Базовая высота
        'fill-extrusion-opacity': 0.6 // Прозрачность
    },
    filter: [
      'all',
      ['has', 'render_height'], // Проверяем, что поле render_height существует
      ['has', 'render_min_height'], // Проверяем, что поле render_min_height существует
      ['==', '$type', 'Polygon'], // Убедитесь, что объекты являются полигонами     
    ]
});
  
  // Создание источника для station
  myMap.addSource("stations", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

    myMap.addLayer({
      id: 'stations-layer',
      type: 'symbol',
      source: 'stations',
      layout: {
        'icon-image': 'custom-marker', // Используем загруженное изображение
        'icon-size': 1 // Масштабирование изображения (по желанию)
      }
    });

  // Создание источника для окружностей
  myMap.addSource("circles", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  // Добавление слоя для окружностей
  myMap.addLayer({
    id: "circles-layer",
    type: "fill",
    source: "circles",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.3,
    },
  });

  // Создание источника для geomarks
  myMap.addSource("geomarks", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  // Добавление слоя для geomarks
  myMap.addLayer({
    id: "geomarks-layer",
    type: "symbol",
    source: "geomarks",
    layout: {
      "icon-image": "marker-15", // Пример изображения маркера
      "icon-size": 1,
    },
  });

  // Создание источника для полигона пересечения
  myMap.addSource("intersection-circle", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  // Добавление слоя для полигона пересечения
  myMap.addLayer({
    id: "intersection-circle-layer",
    type: "fill",
    source: "intersection-circle",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.5,
    },
  });

  // Сохранение ссылки на источник данных полигона пересечения
  intersectionCircleSource = myMap.getSource("intersection-circle");

  // Отключение отображения слоя с кругами
  myMap.setLayoutProperty("circles-layer", "visibility", "none");


  // Подключение к WebSocket
  const ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    console.log('Соединение WebSocket установлено');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Получены данные:', data); // Отладочное сообщение

    if (data.type === 'stations') {
      handleStationsData(data.data);
    } else if (data.type === 'geomarks') {
      handleGeomarksData(data.data);
    }
  };

  ws.onerror = (error) => {
    console.error('Ошибка WebSocket:', error);
  };

  ws.onclose = (event) => {
    console.log('Соединение WebSocket закрыто:', event);
  };

  // Очистка лога каждую минуту
  setInterval(() => {
    console.clear();
  }, 60000); // 60000 миллисекунд = 1 минута
});

function handleStationsData(data) {
  const stationFeatures = data.map((row) => {
    const longitude = parseFloat(row.longitude);
    const latitude = parseFloat(row.latitude);

    return {
      type: "Feature",
      properties: {
        stationid: row.stationid,
        buildingHeight: row.buildingheight, // Высота здания
      },
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
    };
  }).filter(feature => feature !== null); // Удаляем null значения

  // Добавление или обновление маркеров для станций
  stationFeatures.forEach((feature) => {
    const stationid = feature.properties.stationid;
    const coordinates = feature.geometry.coordinates;
    const buildingHeight = feature.properties.buildingHeight;

    let marker = stations.get(stationid);

    if (!marker) {
      // Создаем новый маркер
      const customMarkerElement = createCustomMarker('/images/stationMarker.png');
      if (!customMarkerElement) {
        console.error(`Ошибка: маркер для станции ${stationid} не создан`);
        return;
      }

      marker = new maplibregl.Marker({
        element: customMarkerElement,
      });

      // Добавляем маркер на карту
      marker.setLngLat(coordinates)
        .setPopup(new maplibregl.Popup().setHTML(`
          <strong>ID:</strong> ${feature.properties.stationid}<br>
        `))
        .addTo(myMap);

      stations.set(stationid, marker);
    } else {
      // Обновляем существующий маркер
      marker.setLngLat(coordinates);
    }
  });
}

function handleGeomarksData(data) {
  allServerData = data;
  
  // Очищаем rssiData перед добавлением новых данных
  rssiData.clear();

  // Группируем данные по deviceid
  const groupedData = data.reduce((acc, row) => {
    const deviceid = row.deviceid;
    if (!acc[deviceid]) {
      acc[deviceid] = [];
    }
    acc[deviceid].push(row);
    return acc;
  }, {});

  // Для каждого устройства выбираем все записи с последним timestamp
  const latestData = Object.values(groupedData).flatMap((deviceData) => {
    // Сортируем данные устройства по времени в порядке убывания
    deviceData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Получаем последний timestamp для этого устройства
    const latestTimestamp = deviceData[0].timestamp;

    // Фильтруем записи, чтобы оставить только те, у которых timestamp равен последнему
    return deviceData.filter(row => row.timestamp === latestTimestamp);
  });

  const geomarkFeatures = latestData.map((row) => {
    const stationid = row.stationid;
    const deviceid = row.deviceid;
    const rssi = row.rssi;

    // Сохраняем rssi для каждой станции в rssiData
    rssiData.set(stationid, rssi);

    // Проверяем, существует ли устройство уже в списке
    if (!deviceList.has(deviceid)) {
      deviceList.add(deviceid);
      deviceFlags[deviceid] = true; // Помечаем устройство как новое
      checkboxStates[deviceid] = false; // Устанавливаем состояние чекбокса в false
    }

    return {
      type: "Feature",
      properties: {
        stationid: row.stationid,
        deviceid: row.deviceid,
        data: row.data,
        timestamp: row.timestamp,
        rssi: rssi,
        packageid: row.packageid,
        color: getDeviceColor(row.deviceid)
      },
      geometry: {
        type: "Point",
        coordinates: [0, 0], // Координаты будут обновлены позже
      },
    };
  });

  // Обновляем список устройств
  updateDeviceList();

  // Обновляем окружности для станций
  updatePolygonsForStations(geomarkFeatures);

  // Обновляем общее количество устройств
  updateTotalDevicesCount();
}

function findIntersectionOfPolygons(polygonsData) {
  if (polygonsData.features.length < 2) {
    console.warn('Недостаточно полигонов для нахождения пересечения');
    return null;
  }

  let maxIntersection = null;
  let maxCount = 0;

  // Проверяем пересечение каждой пары полигонов
  for (let i = 0; i < polygonsData.features.length; i++) {
    let intersection = polygonsData.features[i];
    let count = 1;

    for (let j = 0; j < polygonsData.features.length; j++) {
      if (i !== j) {
        const poly1 = intersection;
        const poly2 = polygonsData.features[j];
        const newIntersection = turf.intersect(turf.featureCollection([poly1, poly2]));

        if (newIntersection) {
          intersection = newIntersection;
          count++;
        }
      }
    }

    if (count > maxCount) {
      maxCount = count;
      maxIntersection = intersection;
    }
  }

  if (!maxIntersection) {
    console.warn('Пересечение не найдено между полигонами');
    return null;
  }

  return maxIntersection;
}

function updatePolygonsForStations(geomarkFeatures) {
  const polygonsSource = myMap.getSource("circles");
  let polygonsData = polygonsSource.getData();

  // Если polygonsData не определен, инициализируем его как пустой FeatureCollection
  if (!polygonsData || polygonsData.type !== "FeatureCollection") {
    polygonsData = {
      type: "FeatureCollection",
      features: [],
    };
  }

  // Создаем множество для отслеживания существующих полигонов
  const newPolygons = new Set();

  geomarkFeatures.forEach((geomarkFeature) => {
    const stationid = geomarkFeature.properties.stationid;
    const deviceid = geomarkFeature.properties.deviceid;
    const color = geomarkFeature.properties.color;
    const timestamp = geomarkFeature.properties.timestamp; // Получаем timestamp

    const stationMarker = stations.get(stationid);
    if (!stationMarker) {
      console.warn(`Станция с id ${stationid} не найдена`);
      return;
    }

    const stationCoordinates = stationMarker.getLngLat();
    const rssi = geomarkFeature.properties.rssi; // Используем RSSI из geomarkFeature

    if (rssi !== undefined) {
      const distance = calculateDistance(rssi); // Вычисляем расстояние на основе RSSI

      // Преобразуем координаты в массив чисел
      const coordinatesArray = [stationCoordinates.lng, stationCoordinates.lat];

      // Усекаем координаты станции
      const truncatedCoordinates = turf.truncate(turf.point(coordinatesArray), { precision: 6 });

      // Создание полигона с использованием turf.js
      const polygon = turf.buffer(truncatedCoordinates, distance, {
        units: 'meters',
      });

      // Усечение координат каждой точки в полигоне
      const truncatedPolygon = turf.truncate(polygon, { precision: 6 });

      truncatedPolygon.properties = {
        stationid: stationid,
        deviceid: deviceid,
        color: color
      };

      // Добавление полигона на карту
      polygonsData.features.push(truncatedPolygon);

      // Добавляем идентификатор станции и устройства в множество новых полигонов
      newPolygons.add(`${stationid}-${deviceid}`);

      // Создаем уникальный идентификатор для источника данных полигона
      const circleSourceId = `circle-source-${deviceid}-${stationid}`;

      // Проверяем, существует ли уже источник данных для этого полигона
      if (!myMap.getSource(circleSourceId)) {
        // Если нет, создаем новый источник данных
        myMap.addSource(circleSourceId, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });

        // Добавляем слой для отображения полигона
        const layerId = `circles-layer-${deviceid}-${stationid}`;
        myMap.addLayer({
          id: layerId,
          type: "fill",
          source: circleSourceId,
          paint: {
            "fill-color": color,
            "fill-opacity": 0.3,
          },
          layout: {
            visibility: 'none', // Видимость по умолчанию выключена
          },
        });

        // Добавляем слой в объект состояния видимости
        layerVisibilityStates[layerId] = false;

        // Устанавливаем состояние чекбокса для нового устройства в false
        checkboxStates[deviceid] = false;
      }

      // Обновляем данные в источнике данных полигона
      myMap.getSource(circleSourceId).setData({
        type: "FeatureCollection",
        features: [truncatedPolygon],
      });
    } else {
      console.warn(`RSSI для станции ${stationid} и устройства ${deviceid} не определено`);
    }
  });

  // Удаляем полигоны, которые больше не нужны
  polygonsData.features = polygonsData.features.filter((feature) => {
    const polygonKey = `${feature.properties.stationid}-${feature.properties.deviceid}`;
    if (!newPolygons.has(polygonKey)) {
      // Удаляем источник данных и слой для удаленного полигона
      const circleSourceId = `circle-source-${feature.properties.deviceid}-${feature.properties.stationid}`;
      const layerId = `circles-layer-${feature.properties.deviceid}-${feature.properties.stationid}`;
      if (myMap.getSource(circleSourceId)) {
        myMap.removeLayer(layerId);
        myMap.removeSource(circleSourceId);
        delete layerVisibilityStates[layerId]; // Удаляем слой из объекта состояния видимости
      }
      return false;
    }
    return true;
  });

  // Обновляем множество существующих полигонов
  existingCircles = newPolygons;

  // Обновление данных в источнике polygons
  polygonsSource.setData(polygonsData);

  // Логирование количества полигонов
  console.log(`Количество полигонов: ${polygonsData.features.length}`);

  // Находим пересечение полигонов для каждого устройства
  const deviceIntersections = new Map();

  geomarkFeatures.forEach((geomarkFeature) => {
    const deviceid = geomarkFeature.properties.deviceid;
    const color = geomarkFeature.properties.color;
    const timestamp = geomarkFeature.properties.timestamp; // Получаем timestamp

    // Фильтруем полигоны для текущего устройства
    const devicePolygons = polygonsData.features.filter(feature => feature.properties.deviceid === deviceid);

    if (devicePolygons.length > 1) {
      // Находим пересечение полигонов для текущего устройства
      const intersection = findIntersectionOfPolygons({
        type: "FeatureCollection",
        features: devicePolygons
      });

      if (intersection) {
        deviceIntersections.set(deviceid, { intersection, color, timestamp }); // Добавляем timestamp
      }
    }
  });

  // Удаляем метки пересечения, которые больше не нужны
  intersectionMarkers.forEach((marker, deviceid) => {
    if (!deviceIntersections.has(deviceid)) {
      marker.remove();
      intersectionMarkers.delete(deviceid);
    }
  });

  // Ставим метку в точке пересечения для каждого устройства
  deviceIntersections.forEach(({ intersection, color, timestamp }, deviceid) => {
    placeMarkerAtIntersection(intersection, deviceid, color, timestamp); // Передаем timestamp
  });

  console.log("Конец обновления полигонов");
}

function placeMarkerAtIntersection(intersection, deviceid, color, timestamp) {
  if (!intersection) return;

  // Получаем координаты центра пересечения
  const centroid = turf.centroid(intersection);
  const coordinates = centroid.geometry.coordinates;

  // Создаем уникальный идентификатор для источника данных пульсирующей точки
  const pulsingSourceId = `pulsing-source-${deviceid}`;

  // Проверяем, существует ли уже источник данных для этой пульсирующей точки
  if (!myMap.getSource(pulsingSourceId)) {
    // Если нет, создаем новый источник данных
    myMap.addSource(pulsingSourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              deviceid: deviceid,
              color: color,
              timestamp: timestamp, // Добавляем timestamp в свойства
            },
            geometry: {
              type: "Point",
              coordinates: coordinates,
            },
          },
        ],
      },
    });

    // Добавляем слой для центрального круга (статичный)
    const innerCircleLayerId = `inner-circle-layer-${deviceid}`;
    myMap.addLayer({
      id: innerCircleLayerId,
      type: "circle",
      source: pulsingSourceId,
      paint: {
        "circle-color": color, // Цвет центрального круга
        "circle-radius": 5, // Фиксированный радиус центрального круга
        "circle-opacity": 1, // Полная непрозрачность
        "circle-stroke-color": "white", // Цвет обводки (белый)
        "circle-stroke-width": 2, // Толщина обводки
        "circle-stroke-opacity": 1, // Непрозрачность обводки
      },
    });

    // Добавляем слой для пульсирующей области (анимированный)
    const pulsingLayerId = `pulsing-layer-${deviceid}`;
    myMap.addLayer({
      id: pulsingLayerId,
      type: "circle",
      source: pulsingSourceId,
      paint: {
        "circle-color": color, // Цвет пульсирующей области
        "circle-radius": 1, // Начальный радиус пульсирующей области
        "circle-opacity": 0.5, // Начальная прозрачность
      },
    });

    // Запускаем анимацию пульсирующей точки
    animatePulsingCircle(pulsingLayerId, color);

    // Сохраняем идентификатор источника данных пульсирующей точки
    deviceCircles.set(deviceid, pulsingSourceId);

    // Добавляем обработчик события клика для пульсирующей точки
    myMap.on('click', pulsingLayerId, (e) => {
      const feature = e.features[0]; // Получаем объект, на который кликнули
      if (feature && feature.properties && feature.properties.deviceid) {
        const deviceid = feature.properties.deviceid;
        const timestamp = feature.properties.timestamp; // Получаем timestamp из свойств
        const formattedTimestamp = formatTimestamp(timestamp);

        // Создаем всплывающее окно с информацией о deviceid и timestamp
        const popupContent = `
          <strong>Device ID:</strong> ${deviceid}<br>
          <strong>Timestamp:</strong> ${formattedTimestamp}<br>
        `;

        const popup = new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(popupContent)
          .addTo(myMap);
      }
    });

    // Добавляем обработчик события наведения мыши для подсветки пульсирующей точки
    myMap.on('mouseenter', pulsingLayerId, () => {
      myMap.getCanvas().style.cursor = 'pointer'; // Меняем курсор на указатель
    });

    myMap.on('mouseleave', pulsingLayerId, () => {
      myMap.getCanvas().style.cursor = ''; // Возвращаем курсор в исходное состояние
    });
  } else {
    // Если источник данных уже существует, обновляем только координаты
    myMap.getSource(pulsingSourceId).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            deviceid: deviceid,
            color: color,
            timestamp: timestamp, // Добавляем timestamp в свойства
          },
          geometry: {
            type: "Point",
            coordinates: coordinates,
          },
        },
      ],
    });
  }
}