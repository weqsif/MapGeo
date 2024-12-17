const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const port = 3000;

// Настройки подключения к базе данных
const pool = new Pool({
  user: 'postgres',
  host: '10.7.99.97',
  database: 'GeoPager',
  password: 'admin',
  port: 5432, // Порт по умолчанию для PostgreSQL
});

// Middleware для обработки CORS
app.use(cors());

// Маршрут для получения маркеров станций
app.get('/stations', async (req, res) => {
  try {
    const query = 'SELECT stationid, longitude, latitude, buildingheight FROM stations';
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error.message);
    console.error('Подробная информация об ошибке:', error);
    res.status(500).json({ error: 'Ошибка сервера', details: error.message });
  }
});

// Маршрут для получения маркеров геометок
app.get('/geomarks', async (req, res) => {
  try {
    const query = 'SELECT deviceid, data, timestamp, stationid, rssi, packageid, id FROM station_senddata';
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error.message);
    console.error('Подробная информация об ошибке:', error);
    res.status(500).json({ error: 'Ошибка сервера', details: error.message });
  }
});

const server = app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws) => {
  console.log('Новое соединение WebSocket');

  let interval;

  try {
    // Отправка текущих маркеров станций при подключении
    const stationsQuery = 'SELECT stationid, longitude, latitude, buildingheight FROM stations';
    const stationsResult = await pool.query(stationsQuery);
    ws.send(JSON.stringify({ type: 'stations', data: stationsResult.rows }));

    // Отправка текущих маркеров геометок при подключении
    const geomarksQuery = 'SELECT deviceid, data, timestamp, stationid, rssi, packageid, id FROM station_senddata';
    const geomarksResult = await pool.query(geomarksQuery);
    ws.send(JSON.stringify({ type: 'geomarks', data: geomarksResult.rows }));

    // Обновление данных по сигналу от геометок
    interval = setInterval(async () => {
      try {
        const { rows } = await pool.query(geomarksQuery);
        ws.send(JSON.stringify({ type: 'geomarks', data: rows }));
      } catch (error) {
        console.error('Ошибка при получении маркеров:', error);
      }
    }, 5000);
  } catch (error) {
    console.error('Ошибка при получении данных:', error);
  }

  // Очистка интервала при закрытии соединения
  ws.on('close', () => {
    clearInterval(interval);
    console.log('Соединение WebSocket закрыто');
  });

  // Обработка ошибок при отправке данных через WebSocket
  ws.on('error', (error) => {
    console.error('Ошибка WebSocket:', error);
  });
});

// Закрытие пула соединений при остановке сервера
process.on('SIGINT', async () => {
  console.log('Закрытие соединений с базой данных...');
  await pool.end();
  console.log('Соединения с базой данных закрыты.');
  process.exit(0);
});