const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs').promises;
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

// Папка для хранения данных
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');

// Базовая структура данных
const defaultItems = [
  { id: 1, name: 'Морковь', type: 'food', rarity: 'common', price: 5 },
  { id: 2, name: 'Яблоко', type: 'food', rarity: 'common', price: 10 },
  { id: 3, name: 'Золотое яблоко', type: 'food', rarity: 'rare', price: 50 },
  { id: 4, name: 'Деревянный меч', type: 'equipment', rarity: 'common', price: 30 },
  { id: 5, name: 'Железная броня', type: 'equipment', rarity: 'uncommon', price: 100 },
  { id: 6, name: 'Обычный ключ', type: 'key', rarity: 'common', price: 100 },
  { id: 7, name: 'Семена моркови', type: 'seed', rarity: 'common', price: 10 },
  { id: 8, name: 'Саженец яблони', type: 'seed', rarity: 'uncommon', price: 50 }
];

// Инициализация данных
async function initData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Создаем файл предметов если его нет
    try {
      await fs.access(ITEMS_FILE);
    } catch {
      await fs.writeFile(ITEMS_FILE, JSON.stringify(defaultItems, null, 2));
    }
    
    // Создаем файл пользователей если его нет
    try {
      await fs.access(USERS_FILE);
    } catch {
      await fs.writeFile(USERS_FILE, JSON.stringify({}, null, 2));
    }
    
    console.log('✅ Данные инициализированы');
  } catch (error) {
    console.error('❌ Ошибка инициализации данных:', error);
  }
}

// ==================== РАБОТА С ДАННЫМИ ====================
async function getUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('❌ Ошибка сохранения пользователей:', error);
  }
}

async function getItems() {
  try {
    const data = await fs.readFile(ITEMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return defaultItems;
  }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
async function getOrCreateUser(telegramId, username) {
  const users = await getUsers();
  const userId = telegramId.toString();
  
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      telegramId: telegramId,
      username: username,
      coins: 100,
      gems: 5,
      pet: {
        name: 'Мой дракончик',
        type: 'dragon',
        level: 1,
        exp: 0,
        hunger: 50,
        energy: 80,
        mood: 70,
        health: 100,
        attack: 10,
        defense: 5,
        speed: 8,
        lastUpdate: new Date().toISOString()
      },
      garden: {
        slot1: null,
        slot2: null,
        slot3: null,
        plantedAt: {}
      },
      inventory: [
        { itemId: 1, quantity: 3 }, // 3 морковки
        { itemId: 7, quantity: 2 }  // 2 семени моркови
      ],
      created: new Date().toISOString()
    };
    
    await saveUsers(users);
  }
  
  return users[userId];
}

function updatePetStats(pet) {
  const now = new Date();
  const lastUpdate = new Date(pet.lastUpdate);
  const hoursPassed = (now - lastUpdate) / (1000 * 60 * 60);
  
  if (hoursPassed > 0) {
    pet.hunger = Math.max(0, pet.hunger - (5 * hoursPassed));
    pet.energy = Math.min(100, pet.energy + (2 * hoursPassed));
    pet.mood = Math.max(0, pet.mood - (3 * hoursPassed));
    
    if (pet.hunger < 20) {
      pet.health = Math.max(0, pet.health - (2 * hoursPassed));
    }
    
    pet.lastUpdate = now.toISOString();
  }
  
  return pet;
}

// ==================== КЛАВИАТУРЫ ====================
const mainKeyboard = Markup.keyboard([
  ['🐶 Мой питомец', '⚔️ Бой'],
  ['🌱 Сад', '🎒 Инвентарь'],
  ['🏪 Магазин']
]).resize();

// ==================== КОМАНДЫ БОТА ====================
bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  
  await ctx.reply(
    `🎮 Добро пожаловать в Pet Arena!\n\n` +
    `🐾 Ваш питомец ${user.pet.name} готов к приключениям!\n` +
    `💰 Монет: ${user.coins}\n` +
    `💎 Самоцветов: ${user.gems}\n\n` +
    `Выберите действие:`,
    mainKeyboard
  );
});

bot.hears('🐶 Мой питомец', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.reply('Сначала запустите бота командой /start');
    return;
  }
  
  user.pet = updatePetStats(user.pet);
  await saveUsers(users);
  
  const pet = user.pet;
  
  await ctx.reply(
    `🐾 ${pet.name} (${pet.type})\n` +
    `📊 Уровень: ${pet.level} | Опыт: ${pet.exp}/${pet.level * 100}\n\n` +
    `❤️ Здоровье: ${getStatusEmoji(pet.health)} ${pet.health.toFixed(1)}%\n` +
    `🍖 Голод: ${getStatusEmoji(pet.hunger)} ${pet.hunger.toFixed(1)}%\n` +
    `⚡ Энергия: ${getStatusEmoji(pet.energy)} ${pet.energy.toFixed(1)}%\n` +
    `😊 Настроение: ${getStatusEmoji(pet.mood)} ${pet.mood.toFixed(1)}%\n\n` +
    `⚔️ Атака: ${pet.attack.toFixed(1)}\n` +
    `🛡️ Защита: ${pet.defense.toFixed(1)}\n` +
    `🏃 Скорость: ${pet.speed.toFixed(1)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🍎 Покормить', 'feed_pet')],
      [Markup.button.callback('🎮 Поиграть', 'play_pet')],
      [Markup.button.callback('💤 Уложить спать', 'sleep_pet')]
    ])
  );
});

bot.hears('⚔️ Бой', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.reply('Сначала запустите бота командой /start');
    return;
  }
  
  const pet = user.pet;
  
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
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.reply('Сначала запустите бота командой /start');
    return;
  }
  
  const garden = user.garden;
  
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
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.reply('Сначала запустите бота командой /start');
    return;
  }
  
  const items = await getItems();
  
  if (user.inventory.length === 0) {
    await ctx.reply('🎒 Ваш инвентарь пуст!', mainKeyboard);
    return;
  }
  
  let inventoryText = '🎒 Ваш инвентарь:\n\n';
  
  user.inventory.forEach(invItem => {
    const item = items.find(i => i.id === invItem.itemId);
    if (item) {
      const emoji = {
        'food': '🍎',
        'equipment': '⚔️',
        'key': '🔑',
        'seed': '🌱'
      }[item.type] || '📦';
      
      inventoryText += `${emoji} ${item.name} x${invItem.quantity}\n`;
    }
  });
  
  await ctx.reply(inventoryText, mainKeyboard);
});

bot.hears('🏪 Магазин', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.reply('Сначала запустите бота командой /start');
    return;
  }
  
  const items = await getItems();
  
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

// ==================== CALLBACK ОБРАБОТЧИКИ ====================
bot.action('feed_pet', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.answerCbQuery('❌ Ошибка пользователя');
    return;
  }
  
  // Ищем еду в инвентаре
  const foodIndex = user.inventory.findIndex(invItem => {
    const items = defaultItems; // Используем дефолтные предметы
    const item = items.find(i => i.id === invItem.itemId);
    return item && item.type === 'food';
  });
  
  if (foodIndex === -1) {
    await ctx.answerCbQuery('У вас нет еды! Купите в магазине.');
    return;
  }
  
  // Используем еду
  if (user.inventory[foodIndex].quantity === 1) {
    user.inventory.splice(foodIndex, 1);
  } else {
    user.inventory[foodIndex].quantity -= 1;
  }
  
  // Кормим питомца
  user.pet.hunger = Math.min(100, user.pet.hunger + 30);
  await saveUsers(users);
  
  await ctx.answerCbQuery('Питомец покормлен! +30 к голоду');
  await ctx.editMessageText(
    `🍎 Вы покормили питомца!\n` +
    `🍖 Голод: ${user.pet.hunger.toFixed(1)}%\n` +
    `🍎 Еды осталось: ${user.inventory[foodIndex]?.quantity || 0}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('👈 Назад', 'back_to_main')]
    ])
  );
});

bot.action('battle_easy', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.answerCbQuery('❌ Ошибка пользователя');
    return;
  }
  
  const pet = user.pet;
  
  // Простой бой
  const playerDamage = Math.floor(Math.random() * 15) + 10;
  const aiDamage = Math.floor(Math.random() * 10) + 5;
  
  const playerHealth = Math.max(0, pet.health - aiDamage);
  const win = playerHealth > 0;
  
  if (win) {
    const reward = Math.floor(Math.random() * 11) + 10; // 10-20 монет
    user.coins += reward;
    pet.health = playerHealth;
    pet.exp += 5;
    
    // Проверяем повышение уровня
    const neededExp = pet.level * 100;
    if (pet.exp >= neededExp) {
      pet.level += 1;
      pet.exp = 0;
      pet.attack += 2;
      pet.defense += 1;
      pet.health = 100;
    }
    
    // Шанс получить предмет (30%)
    if (Math.random() < 0.3) {
      const commonItems = defaultItems.filter(item => item.rarity === 'common');
      const randomItem = commonItems[Math.floor(Math.random() * commonItems.length)];
      
      const existingItem = user.inventory.find(inv => inv.itemId === randomItem.id);
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        user.inventory.push({ itemId: randomItem.id, quantity: 1 });
      }
    }
    
    await saveUsers(users);
    
    await ctx.editMessageText(
      `🎉 ПОБЕДА!\n\n` +
      `Вы нанесли ${playerDamage} урона!\n` +
      `Противник нанес ${aiDamage} урона.\n\n` +
      `💰 Получено: ${reward} монет\n` +
      `⭐ Опыта: +5\n` +
      `${pet.level > user.pet.level ? `🎉 Уровень повышен! Теперь уровень ${pet.level}\n` : ''}` +
      `❤️ Осталось здоровья: ${playerHealth.toFixed(1)}%\n\n` +
      `Продолжайте в том же духе!`,
      mainKeyboard
    );
  } else {
    pet.health = 50; // Восстанавливаем немного здоровья
    await saveUsers(users);
    
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
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.answerCbQuery('❌ Ошибка пользователя');
    return;
  }
  
  // Ищем семена в инвентаре
  const seeds = user.inventory.filter(invItem => {
    const item = defaultItems.find(i => i.id === invItem.itemId);
    return item && item.type === 'seed';
  });
  
  if (seeds.length === 0) {
    await ctx.answerCbQuery('У вас нет семян! Купите в магазине.');
    return;
  }
  
  // Создаем кнопки для выбора семян
  const buttons = seeds.map(seed => {
    const item = defaultItems.find(i => i.id === seed.itemId);
    return [Markup.button.callback(`🌱 ${item.name} (осталось: ${seed.quantity})`, `use_seed_${seed.itemId}`)];
  });
  
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel_action')]);
  
  await ctx.editMessageText(
    'Выберите семена для посадки:',
    Markup.inlineKeyboard(buttons)
  );
});

bot.action(/use_seed_(\d+)/, async (ctx) => {
  const itemId = parseInt(ctx.match[1]);
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.answerCbQuery('❌ Ошибка пользователя');
    return;
  }
  
  // Находим свободный слот
  let freeSlot = null;
  for (let i = 1; i <= 3; i++) {
    if (!user.garden[`slot${i}`]) {
      freeSlot = i;
      break;
    }
  }
  
  if (!freeSlot) {
    await ctx.answerCbQuery('❌ Нет свободных слотов в саду!');
    return;
  }
  
  // Используем семена
  const seedIndex = user.inventory.findIndex(inv => inv.itemId === itemId);
  if (seedIndex === -1) {
    await ctx.answerCbQuery('❌ Семена не найдены!');
    return;
  }
  
  if (user.inventory[seedIndex].quantity === 1) {
    user.inventory.splice(seedIndex, 1);
  } else {
    user.inventory[seedIndex].quantity -= 1;
  }
  
  // Сажаем растение
  const item = defaultItems.find(i => i.id === itemId);
  user.garden[`slot${freeSlot}`] = item.name;
  user.garden.plantedAt[`slot${freeSlot}`] = new Date().toISOString();
  
  await saveUsers(users);
  
  await ctx.editMessageText(
    `🌱 Посажено ${item.name} в слот ${freeSlot}!\n` +
    `Собирать урожай можно через 2 часа.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('👈 Назад к саду', 'back_to_garden')]
    ])
  );
});

bot.action('buy_carrot', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) {
    await ctx.answerCbQuery('❌ Ошибка пользователя');
    return;
  }
  
  const carrotPrice = 5;
  
  if (user.coins < carrotPrice) {
    await ctx.answerCbQuery('❌ Недостаточно монет!');
    return;
  }
  
  user.coins -= carrotPrice;
  
  // Добавляем морковь в инвентарь
  const carrotId = 1; // ID моркови
  const existingCarrot = user.inventory.find(inv => inv.itemId === carrotId);
  if (existingCarrot) {
    existingCarrot.quantity += 1;
  } else {
    user.inventory.push({ itemId: carrotId, quantity: 1 });
  }
  
  await saveUsers(users);
  
  await ctx.answerCbQuery('✅ Куплена 1 морковь за 5 монет');
  await ctx.editMessageText(
    `🍎 Куплена 1 морковь!\n` +
    `💰 Осталось монет: ${user.coins}\n` +
    `🍎 Моркови в инвентаре: ${existingCarrot ? existingCarrot.quantity + 1 : 1}`,
    mainKeyboard
  );
});

bot.action('back_to_main', async (ctx) => {
  await ctx.editMessageText('Главное меню:', mainKeyboard);
  await ctx.answerCbQuery();
});

bot.action('back_to_garden', async (ctx) => {
  const users = await getUsers();
  const userId = ctx.from.id.toString();
  const user = users[userId];
  
  if (!user) return;
  
  const garden = user.garden;
  
  let gardenText = '🌱 Ваш сад:\n\n';
  for (let i = 1; i <= 3; i++) {
    const slot = garden[`slot${i}`];
    gardenText += `${i}. ${slot ? `🌱 ${slot}` : '🌫️ Пусто'}\n`;
  }
  
  await ctx.editMessageText(
    gardenText,
    Markup.inlineKeyboard([
      [Markup.button.callback('🌱 Посадить растение', 'plant_seed')],
      [Markup.button.callback('🌾 Собрать урожай', 'harvest_garden')]
    ])
  );
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getStatusEmoji(value) {
  if (value >= 80) return '🟢';
  if (value >= 50) return '🟡';
  if (value >= 30) return '🟠';
  return '🔴';
}

// ==================== ЗАПУСК БОТА ====================
// Инициализируем данные
initData();

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
