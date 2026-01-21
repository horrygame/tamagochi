const axios = require('axios');

// URL вашего приложения на Render
const RENDER_URL = process.env.RENDER_URL || 'https://your-bot.onrender.com';

async function pingServer() {
  try {
    const response = await axios.get(`${RENDER_URL}/health`);
    console.log(`[${new Date().toISOString()}] Ping successful: ${response.status}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ping failed:`, error.message);
  }
}

// Пинг каждые 5 минут (300000 мс)
setInterval(pingServer, 5 * 60 * 1000);

// Первый пинг при запуске
console.log('Keep-alive script started');
pingServer();

module.exports = { pingServer };
