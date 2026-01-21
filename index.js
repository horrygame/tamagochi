const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Загрузка переменных окружения
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Ошибка: BOT_TOKEN не установлен!');
  process.exit(1);
}

// Инициализация Express для health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    service: 'Telegram Tamagochi Bot'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Health server listening on port ${PORT}`);
});

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Инициализация БД
const dbPath = path.join(__dirname, 'data', 'tamagochi.db');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);

// Создаем таблицы если их нет
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    coins INTEGER DEFAULT 100,
    gems INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT DEFAULT 'Питомец',
    type TEXT DEFAULT 'dragon',
    level INTEGER DEFAULT 1,
    exp INTEGER DEFAULT 0,
    hunger REAL DEFAULT 50.0,
    energy REAL DEFAULT 80.0,
    mood REAL DEFAULT 70.0,
    health REAL DEFAULT 100.0,
    attack REAL DEFAULT 10.0,
    defense REAL DEFAULT 5.0,
    speed REAL DEFAULT 8.0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS gardens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    slot1 TEXT,
    slot2 TEXT,
    slot3 TEXT,
    planted_at TEXT DEFAULT '{}',
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    rarity TEXT DEFAULT 'common',
    price INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES items(id)
  );
`);

// Заполняем базовые предметы
const itemCount = db.prepare('SELECT COUNT(*) as count FROM items').get();
if (itemCount.count === 0) {
  const items = [
    ['Морковь', 'food', 'common', 5],
    ['Яблоко', 'food', 'common', 10],
    ['Золотое яблоко', 'food', 'rare', 50],
    ['Деревянный меч', 'equipment', 'common', 30],
    ['Железная броня', 'equipment', 'uncommon', 100],
    ['Обычный ключ', 'key', 'common', 100],
    ['Семена моркови', 'seed', 'common', 10],
    ['Саженец яблони', 'seed', 'uncommon', 50]
  ];
  
  const stmt = db.prepare('INSERT INTO items (name, type, rarity, price) VALUES (?, ?, ?, ?)');
  const insert = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  
  insert(items);
  console.log('✅ Базовые предметы добавлены');
}

// ==================== КЛАВИАТУРЫ ====================
const mainKeyboard = Markup.keyboard([
  ['🐶 Мой питомец', '⚔️ Бой'],
  ['🌱 Сад', '🎒 Инвентарь'],
  ['🏪 Магазин']
]).resize();

const backKeyboard = Markup.keyboard([['⬅️ Назад']]).resize();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getOrCreateUser(telegramId, username) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  
  if (!user) {
    db.prepare('INSERT INTO users (telegram_id, username) VALUES (?, ?)').run(telegramId, username);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    
    // Создаем питомца
    db.prepare(`
      INSERT INTO pets (user_id, name, type) 
      VALUES (?, ?, ?)
    `).run(user.id, 'Мой дракончик', 'dragon');
    
    // Создаем сад
    db.prepare('INSERT INTO gardens (user_id) VALUES (?)').run(user.id);
    
    // Даем стартовые предметы
    const carrot = db.prepare('SELECT id FROM items WHERE name = ?').get('Морковь');
    if (carrot) {
      db.prepare('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)')
        .run(user.id, carrot.id, 3);
    }
  }
  
  return user;
}

function getPet(userId) {
  return db.prepare('SELECT * FROM pets WHERE user_id = ?').get(userId);
}

function updatePetStats(petId) {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(petId);
  
  // Уменьшаем голод и настроение со временем
  const newHunger = Math.max(0, pet.hunger - 0.5);
  const newMood = Math.max(0, pet.mood - 0.3);
  const newEnergy = Math.min(100, pet.energy + 1);
  
  db.prepare(`
    UPDATE pets 
    SET hunger = ?, mood = ?, energy = ?
    WHERE id = ?
  `).run(newHunger, newMood, newEnergy, petId);
}

// ==================== КОМАНДЫ БОТА ====================
bot.start(async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  const pet = getPet(user.id);
  
  await ctx.reply(
    `🎮 Добро пожаловать в Pet Arena!\n\n` +
    `🐾 Ваш питомец ${pet.name} готов к приключениям!\n` +
    `💰 Монет: ${user.coins}\n` +
    `💎 Самоцветов: ${user.gems}\n\n` +
    `Выберите действие:`,
    mainKeyboard
  );
});

bot.hears('🐶 Мой питомец', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = getPet(user.id);
  updatePetStats(pet.id);
  
  const updatedPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(pet.id);
  
  await ctx.reply(
    `🐾 ${updatedPet.name}\n` +
    `📊 Уровень: ${updatedPet.level}\n` +
    `❤️ Здоровье: ${updatedPet.health.toFixed(1)}%\n` +
    `🍖 Голод: ${updatedPet.hunger.toFixed(1)}%\n` +
    `⚡ Энергия: ${updatedPet.energy.toFixed(1)}%\n` +
    `😊 Настроение: ${updatedPet.mood.toFixed(1)}%\n\n` +
    `⚔️ Атака: ${updatedPet.attack.toFixed(1)}\n` +
    `🛡️ Защита: ${updatedPet.defense.toFixed(1)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🍎 Покормить', 'feed_pet')],
      [Markup.button.callback('🎮 Поиграть', 'play_pet')],
      [Markup.button.callback('💤 Уложить спать', 'sleep_pet')]
    ])
  );
});

bot.hears('⚔️ Бой', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = getPet(user.id);
  
  await ctx.reply(
    `⚔️ Арена битв\n\n` +
    `Ваш питомец: ${pet.name}\n` +
    `❤️ Здоровье: ${pet.health.toFixed(1)}%\n` +
    `⚔️ Атака: ${pet.attack.toFixed(1)}\n\n` +
    `Выберите противника:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🤖 Легкий бот (награда: 10-20 монет)', 'battle_easy')],
      [Markup.button.callback('⚔️ Средний бот (награда: 20-40 монет)', 'battle_medium')],
      [Markup.button.callback('👹 Сложный бот (награда: 40-80 монет)', 'battle_hard')]
    ])
  );
});

bot.hears('🌱 Сад', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const garden = db.prepare('SELECT * FROM gardens WHERE user_id = ?').get(user.id);
  
  let gardenText = '🌱 Ваш сад:\n\n';
  for (let i = 1; i <= 3; i++) {
    const slot = garden[`slot${i}`];
    gardenText += `${i}. ${slot ? `🌱 ${slot}` : '🌫️ Пусто'}\n`;
  }
  
  await ctx.reply(
    gardenText,
    Markup.inlineKeyboard([
      [Markup.button.callback('🌱 Посадить растение', 'plant_seed')],
      [Markup.button.callback('🌾 Собрать урожай', 'harvest_garden')]
    ])
  );
});

bot.hears('🎒 Инвентарь', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  const inventory = db.prepare(`
    SELECT i.name, i.type, inv.quantity 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ?
  `).all(user.id);
  
  if (inventory.length === 0) {
    await ctx.reply('🎒 Ваш инвентарь пуст!', mainKeyboard);
    return;
  }
  
  let inventoryText = '🎒 Ваш инвентарь:\n\n';
  inventory.forEach(item => {
    const emoji = {
      'food': '🍎',
      'equipment': '⚔️',
      'key': '🔑',
      'seed': '🌱'
    }[item.type] || '📦';
    
    inventoryText += `${emoji} ${item.name} x${item.quantity}\n`;
  });
  
  await ctx.reply(inventoryText, mainKeyboard);
});

bot.hears('🏪 Магазин', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  const items = db.prepare('SELECT * FROM items ORDER BY type, price').all();
  
  let shopText = `🏪 Магазин | Монеты: ${user.coins}\n\n`;
  
  items.forEach(item => {
    const emoji = {
      'food': '🍎',
      'equipment': '⚔️',
      'key': '🔑',
      'seed': '🌱'
    }[item.type] || '📦';
    
    shopText += `${emoji} ${item.name} - ${item.price} монет (${item.rarity})\n`;
  });
  
  await ctx.reply(
    shopText,
    Markup.inlineKeyboard([
      [Markup.button.callback('🍎 Купить морковь (5 монет)', 'buy_carrot')],
      [Markup.button.callback('🌱 Купить семена (10 монет)', 'buy_seeds')],
      [Markup.button.callback('🔑 Купить ключ (100 монет)', 'buy_key')]
    ])
  );
});

bot.hears('⬅️ Назад', async (ctx) => {
  await ctx.reply('Главное меню:', mainKeyboard);
});

// ==================== CALLBACK ОБРАБОТЧИКИ ====================
bot.action('feed_pet', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = getPet(user.id);
  
  // Проверяем есть ли еда в инвентаре
  const food = db.prepare(`
    SELECT inv.id, inv.quantity 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ? AND i.type = 'food'
    LIMIT 1
  `).get(user.id);
  
  if (!food) {
    await ctx.answerCbQuery('У вас нет еды! Купите в магазине.');
    return;
  }
  
  // Используем еду
  if (food.quantity === 1) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(food.id);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(food.id);
  }
  
  // Кормим питомца
  const newHunger = Math.min(100, pet.hunger + 30);
  db.prepare('UPDATE pets SET hunger = ? WHERE id = ?').run(newHunger, pet.id);
  
  await ctx.answerCbQuery('Питомец покормлен! +30 к голоду');
  await ctx.editMessageText(
    `🍎 Вы покормили питомца!\n` +
    `🍖 Голод: ${newHunger.toFixed(1)}%\n` +
    `🍎 Еды осталось: ${food.quantity - 1}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('👈 Назад к питомцу', 'back_to_pet')]
    ])
  );
});

bot.action('battle_easy', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = getPet(user.id);
  
  // Простой бой
  const playerDamage = Math.floor(Math.random() * 15) + 10;
  const aiDamage = Math.floor(Math.random() * 10) + 5;
  
  const playerHealth = Math.max(0, pet.health - aiDamage);
  const win = playerHealth > 0;
  
  if (win) {
    const reward = Math.floor(Math.random() * 11) + 10; // 10-20 монет
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(reward, user.id);
    db.prepare('UPDATE pets SET health = ?, exp = exp + 5 WHERE id = ?').run(playerHealth, pet.id);
    
    // Шанс получить предмет
    if (Math.random() < 0.3) {
      const item = db.prepare('SELECT id FROM items WHERE rarity = ? ORDER BY RANDOM() LIMIT 1').get('common');
      if (item) {
        db.prepare(`
          INSERT OR REPLACE INTO inventory (user_id, item_id, quantity) 
          VALUES (?, ?, COALESCE((SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?), 0) + 1)
        `).run(user.id, item.id, user.id, item.id);
      }
    }
    
    await ctx.editMessageText(
      `🎉 ПОБЕДА!\n\n` +
      `Вы нанесли ${playerDamage} урона!\n` +
      `Противник нанес ${aiDamage} урона.\n\n` +
      `💰 Получено: ${reward} монет\n` +
      `⭐ Опыта: +5\n` +
      `❤️ Осталось здоровья: ${playerHealth.toFixed(1)}%\n\n` +
      `Продолжайте в том же духе!`,
      mainKeyboard
    );
  } else {
    db.prepare('UPDATE pets SET health = 50 WHERE id = ?').run(pet.id); // Восстанавливаем немного здоровья
    
    await ctx.editMessageText(
      `💀 ПОРАЖЕНИЕ\n\n` +
      `Противник оказался сильнее!\n` +
      `Ваш питомец теряет сознание...\n\n` +
      `Не сдавайтесь! Попробуйте снова.`,
      mainKeyboard
    );
  }
  
  await ctx.answerCbQuery();
});

bot.action('plant_seed', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  // Проверяем есть ли семена
  const seeds = db.prepare(`
    SELECT inv.id, inv.quantity, i.name 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ? AND i.type = 'seed'
  `).all(user.id);
  
  if (seeds.length === 0) {
    await ctx.answerCbQuery('У вас нет семян! Купите в магазине.');
    return;
  }
  
  let buttons = seeds.map(seed => 
    [Markup.button.callback(`🌱 ${seed.name} (осталось: ${seed.quantity})`, `use_seed_${seed.id}`)]
  );
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel_action')]);
  
  await ctx.editMessageText(
    'Выберите семена для посадки:',
    Markup.inlineKeyboard(buttons)
  );
});

// ==================== ЗАПУСК БОТА ====================
// Подключаем keep-alive
require('./keep-alive');

bot.launch()
  .then(() => {
    console.log('✅ Telegram бот успешно запущен!');
  })
  .catch(err => {
    console.error('❌ Ошибка запуска бота:', err);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🚀 Бот запускается...');
