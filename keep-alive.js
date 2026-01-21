const https = require('https');

// Функция для пинга самого себя (для Render бесплатного тарифа)
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  
  https.get(`${url}/health`, (res) => {
    console.log(`[${new Date().toISOString()}] Keep-alive ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Keep-alive error: ${err.message}`);
  });
}

// Пинг каждые 5 минут
setInterval(keepAlive, 5 * 60 * 1000);

// Первый пинг через 10 секунд после запуска
setTimeout(keepAlive, 10000);

console.log('Keep-alive system started');
