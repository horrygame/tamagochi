const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const https = require('https');

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

// ==================== KEEP-ALIVE СИСТЕМА ====================
function keepAlive() {
  // Используем self-ping через webhook или просто логируем
  console.log(`[${new Date().toISOString()}] Keep-alive ping sent`);
  
  // Если есть URL приложения, пингуем его
  if (process.env.RENDER_EXTERNAL_URL) {
    https.get(`${process.env.RENDER_EXTERNAL_URL}/health`, (res) => {
      console.log(`[${new Date().toISOString()}] Keep-alive response: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`[${new Date().toISOString()}] Keep-alive error: ${err.message}`);
    });
  }
}

// Пинг каждые 5 минут (300000 мс)
setInterval(keepAlive, 5 * 60 * 1000);
// Первый пинг через 30 секунд после запуска
setTimeout(keepAlive, 30000);

console.log('✅ Keep-alive system started');

// ==================== ХРАНЕНИЕ ДАННЫХ В ПАМЯТИ ====================
// На Render бесплатном тарифе файлы не сохраняются, используем память
// При перезапуске данные сбросятся, но это нормально для демо

// Базовая структура данных
const defaultItems = [
  { id: 1, name: 'Морковь', type: 'food', rarity: 'common', price: 5, effect: 'hunger:30' },
  { id: 2, name: 'Яблоко', type: 'food', rarity: 'common', price: 10, effect: 'hunger:50,mood:10' },
  { id: 3, name: 'Золотое яблоко', type: 'food', rarity: 'rare', price: 50, effect: 'hunger:100,health:30,mood:20' },
  { id: 4, name: 'Деревянный меч', type: 'equipment', rarity: 'common', price: 30, effect: 'attack:5' },
  { id: 5, name: 'Железная броня', type: 'equipment', rarity: 'uncommon', price: 100, effect: 'defense:10' },
  { id: 6, name: 'Обычный ключ', type: 'key', rarity: 'common', price: 100, effect: 'open_case:common' },
  { id: 7, name: 'Семена моркови', type: 'seed', rarity: 'common', price: 10, effect: 'grow_time:2,yield:carrot' },
  { id: 8, name: 'Саженец яблони', type: 'seed', rarity: 'uncommon', price: 50, effect: 'grow_time:6,yield:apple' }
];

// Хранилище данных в памяти
let users = new Map(); // Map<telegramId, userData>

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getOrCreateUser(telegramId, username) {
  const userId = telegramId.toString();
  
  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      telegramId: telegramId,
      username: username || 'Игрок',
      coins: 150,
      gems: 10,
      pet: {
        name: 'Дракоша',
        type: 'dragon',
        level: 1,
        exp: 0,
        hunger: 70,
        energy: 90,
        mood: 80,
        health: 100,
        attack: 15,
        defense: 8,
        speed: 12,
        lastUpdate: Date.now()
      },
      garden: {
        slots: [null, null, null], // 3 слота
        plantedAt: {}
      },
      inventory: [
        { itemId: 1, quantity: 5 }, // 5 морковок
        { itemId: 7, quantity: 3 }  // 3 семени моркови
      ],
      battles: [],
      created: Date.now()
    });
    
    console.log(`✅ Создан новый пользователь: ${username} (${telegramId})`);
  }
  
  return users.get(userId);
}

function updatePetStats(pet) {
  const now = Date.now();
  const hoursPassed = (now - pet.lastUpdate) / (1000 * 60 * 60);
  
  if (hoursPassed > 0) {
    // Медленные изменения
    pet.hunger = Math.max(0, pet.hunger - (hoursPassed * 2));
    pet.energy = Math.min(100, pet.energy + (hoursPassed * 3));
    pet.mood = Math.max(0, pet.mood - (hoursPassed * 1.5));
    
    // Если голод низкий - падает здоровье
    if (pet.hunger < 30) {
      pet.health = Math.max(1, pet.health - (hoursPassed * 1));
    }
    
    pet.lastUpdate = now;
  }
  
  // Ограничиваем значения
  pet.hunger = Math.max(0, Math.min(100, pet.hunger));
  pet.energy = Math.max(0, Math.min(100, pet.energy));
  pet.mood = Math.max(0, Math.min(100, pet.mood));
  pet.health = Math.max(1, Math.min(100, pet.health));
  
  return pet;
}

function getStatusEmoji(value) {
  if (value >= 80) return '🟢';
  if (value >= 60) return '🟡';
  if (value >= 40) return '🟠';
  if (value >= 20) return '🔴';
  return '💀';
}

function getItemEmoji(type) {
  const emojis = {
    'food': '🍎',
    'equipment': '⚔️',
    'key': '🔑',
    'seed': '🌱'
  };
  return emojis[type] || '📦';
}

// ==================== КЛАВИАТУРЫ ====================
const mainKeyboard = Markup.keyboard([
  ['🐶 Мой питомец', '⚔️ Бой'],
  ['🌱 Сад', '🎒 Инвентарь'],
  ['🏪 Магазин', 'ℹ️ Помощь']
]).resize();

const battleKeyboard = Markup.keyboard([
  ['⚔️ Легкий бой', '⚔️ Средний бой'],
  ['⚔️ Сложный бой', '⬅️ Назад']
]).resize();

const gardenKeyboard = Markup.keyboard([
  ['🌱 Посадить семена', '🌾 Собрать урожай'],
  ['⬅️ Назад']
]).resize();

// ==================== КОМАНДЫ БОТА ====================
bot.start(async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  
  await ctx.reply(
    `🎮 <b>Добро пожаловать в Pet Arena!</b>\n\n` +
    `🐾 Ваш питомец <b>${user.pet.name}</b> готов к приключениям!\n` +
    `💰 <b>Монеты:</b> ${user.coins}\n` +
    `💎 <b>Самоцветы:</b> ${user.gems}\n\n` +
    `<i>Используйте кнопки ниже для управления:</i>`,
    { 
      parse_mode: 'HTML',
      ...mainKeyboard 
    }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    `ℹ️ <b>Помощь по игре Pet Arena</b>\n\n` +
    `🎮 <b>Основные механики:</b>\n` +
    `• <b>Питомец</b> - имеет параметры: голод, энергия, настроение, здоровье\n` +
    `• <b>Сад</b> - выращивайте еду для питомца\n` +
    `• <b>Бои</b> - сражайтесь с ботами, получайте награды\n` +
    `• <b>Магазин</b> - покупайте предметы за монеты\n\n` +
    `⚔️ <b>Система боев:</b>\n` +
    `• <b>Легкий</b> - 10-20 монет, низкий риск\n` +
    `• <b>Средний</b> - 20-40 монет, средний риск\n` +
    `• <b>Сложный</b> - 40-80 монет, высокий риск\n\n` +
    `🌱 <b>Сад:</b>\n` +
    `• Сажайте семена, собирайте урожай через 2-6 часов\n` +
    `• Урожай добавляется в инвентарь\n\n` +
    `<i>Удачи в игре! 🎮</i>`,
    { 
      parse_mode: 'HTML',
      ...mainKeyboard 
    }
  );
});

bot.hears('🐶 Мой питомец', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  user.pet = updatePetStats(user.pet);
  
  const pet = user.pet;
  const expNeeded = pet.level * 100;
  
  await ctx.reply(
    `🐾 <b>${pet.name}</b> (${pet.type})\n\n` +
    `📊 <b>Уровень:</b> ${pet.level} | <b>Опыт:</b> ${pet.exp}/${expNeeded}\n\n` +
    `❤️ <b>Здоровье:</b> ${getStatusEmoji(pet.health)} ${Math.round(pet.health)}%\n` +
    `🍖 <b>Голод:</b> ${getStatusEmoji(pet.hunger)} ${Math.round(pet.hunger)}%\n` +
    `⚡ <b>Энергия:</b> ${getStatusEmoji(pet.energy)} ${Math.round(pet.energy)}%\n` +
    `😊 <b>Настроение:</b> ${getStatusEmoji(pet.mood)} ${Math.round(pet.mood)}%\n\n` +
    `⚔️ <b>Атака:</b> ${pet.attack.toFixed(1)}\n` +
    `🛡️ <b>Защита:</b> ${pet.defense.toFixed(1)}\n` +
    `🏃 <b>Скорость:</b> ${pet.speed.toFixed(1)}`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🍎 Покормить', 'action_feed'),
          Markup.button.callback('🎮 Поиграть', 'action_play')
        ],
        [
          Markup.button.callback('💤 Усыпить', 'action_sleep'),
          Markup.button.callback('🏋️ Тренировать', 'action_train')
        ]
      ])
    }
  );
});

bot.hears('⚔️ Бой', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = user.pet;
  
  await ctx.reply(
    `⚔️ <b>Арена битв</b>\n\n` +
    `Ваш питомец: <b>${pet.name}</b>\n` +
    `❤️ <b>Здоровье:</b> ${Math.round(pet.health)}%\n` +
    `⚔️ <b>Атака:</b> ${pet.attack.toFixed(1)}\n` +
    `🛡️ <b>Защита:</b> ${pet.defense.toFixed(1)}\n\n` +
    `<i>Выберите сложность боя:</i>`,
    { 
      parse_mode: 'HTML',
      ...battleKeyboard 
    }
  );
});

bot.hears('⚔️ Легкий бой', async (ctx) => {
  await startBattle(ctx, 'easy');
});

bot.hears('⚔️ Средний бой', async (ctx) => {
  await startBattle(ctx, 'medium');
});

bot.hears('⚔️ Сложный бой', async (ctx) => {
  await startBattle(ctx, 'hard');
});

bot.hears('🌱 Сад', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const garden = user.garden;
  
  let gardenText = '🌱 <b>Ваш сад:</b>\n\n';
  
  garden.slots.forEach((slot, index) => {
    const slotNum = index + 1;
    if (slot) {
      const plantedTime = garden.plantedAt[slotNum] || Date.now();
      const hoursPassed = (Date.now() - plantedTime) / (1000 * 60 * 60);
      
      if (hoursPassed >= 2) {
        gardenText += `${slotNum}. ${slot} 🌾 <i>(готово к сбору!)</i>\n`;
      } else {
        const timeLeft = Math.max(0, 2 - hoursPassed);
        gardenText += `${slotNum}. ${slot} ⏳ <i>(осталось: ${timeLeft.toFixed(1)}ч)</i>\n`;
      }
    } else {
      gardenText += `${slotNum}. 🌫️ <i>Пусто</i>\n`;
    }
  });
  
  await ctx.reply(
    gardenText,
    { 
      parse_mode: 'HTML',
      ...gardenKeyboard 
    }
  );
});

bot.hears('🌱 Посадить семена', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  // Проверяем есть ли свободные слоты
  const freeSlots = user.garden.slots.map((slot, idx) => slot === null ? idx + 1 : null).filter(Boolean);
  
  if (freeSlots.length === 0) {
    await ctx.reply('❌ <b>Нет свободных слотов в саду!</b>\nОсвободите место или подождите пока вырастут растения.', { 
      parse_mode: 'HTML',
      ...gardenKeyboard 
    });
    return;
  }
  
  // Ищем семена в инвентаре
  const seeds = user.inventory.filter(inv => {
    const item = defaultItems.find(i => i.id === inv.itemId);
    return item && item.type === 'seed';
  });
  
  if (seeds.length === 0) {
    await ctx.reply('❌ <b>У вас нет семян!</b>\nКупите семена в магазине.', { 
      parse_mode: 'HTML',
      ...gardenKeyboard 
    });
    return;
  }
  
  // Создаем кнопки для выбора семян
  const buttons = seeds.map(seed => {
    const item = defaultItems.find(i => i.id === seed.itemId);
    const growTime = item.effect.includes('grow_time:6') ? '6ч' : '2ч';
    return [Markup.button.callback(`${getItemEmoji('seed')} ${item.name} (${growTime}, осталось: ${seed.quantity})`, `plant_${seed.itemId}`)];
  });
  
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel_plant')]);
  
  await ctx.reply(
    '🌱 <b>Выберите семена для посадки:</b>\n<i>Доступные свободные слоты: ' + freeSlots.join(', ') + '</i>',
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
});

bot.hears('🌾 Собрать урожай', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const garden = user.garden;
  
  let harvested = [];
  
  garden.slots.forEach((slot, index) => {
    if (slot) {
      const slotNum = index + 1;
      const plantedTime = garden.plantedAt[slotNum] || Date.now();
      const hoursPassed = (Date.now() - plantedTime) / (1000 * 60 * 60);
      
      if (hoursPassed >= 2) {
        // Определяем что выросло
        let yieldItemId = 1; // Морковь по умолчанию
        let yieldAmount = 2;
        
        if (slot.includes('яблон')) {
          yieldItemId = 2; // Яблоко
          yieldAmount = 1;
        }
        
        // Добавляем в инвентарь
        const existingItem = user.inventory.find(inv => inv.itemId === yieldItemId);
        if (existingItem) {
          existingItem.quantity += yieldAmount;
        } else {
          user.inventory.push({ itemId: yieldItemId, quantity: yieldAmount });
        }
        
        harvested.push(`${slot} x${yieldAmount}`);
        
        // Очищаем слот
        garden.slots[index] = null;
        delete garden.plantedAt[slotNum];
      }
    }
  });
  
  if (harvested.length > 0) {
    await ctx.reply(
      `🌾 <b>Урожай собран!</b>\n\n` +
      `<b>Получено:</b>\n${harvested.join('\n')}\n\n` +
      `<i>Растения удалены, можно сажать новые!</i>`,
      { 
        parse_mode: 'HTML',
        ...gardenKeyboard 
      }
    );
  } else {
    await ctx.reply(
      '🌱 <b>Еще ничего не выросло!</b>\n<i>Подождите хотя бы 2 часа после посадки.</i>',
      { 
        parse_mode: 'HTML',
        ...gardenKeyboard 
      }
    );
  }
});

bot.hears('🎒 Инвентарь', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  if (user.inventory.length === 0) {
    await ctx.reply('🎒 <b>Ваш инвентарь пуст!</b>\n<i>Купите предметы в магазине или получите в боях.</i>', { 
      parse_mode: 'HTML',
      ...mainKeyboard 
    });
    return;
  }
  
  let inventoryText = '🎒 <b>Ваш инвентарь:</b>\n\n';
  const groupedItems = {};
  
  user.inventory.forEach(inv => {
    const item = defaultItems.find(i => i.id === inv.itemId);
    if (item) {
      if (!groupedItems[item.type]) {
        groupedItems[item.type] = [];
      }
      groupedItems[item.type].push({ item, quantity: inv.quantity });
    }
  });
  
  Object.entries(groupedItems).forEach(([type, items]) => {
    inventoryText += `<b>${type.toUpperCase()}:</b>\n`;
    items.forEach(({ item, quantity }) => {
      inventoryText += `${getItemEmoji(item.type)} ${item.name} x${quantity}\n`;
    });
    inventoryText += '\n';
  });
  
  inventoryText += `💰 <b>Монеты:</b> ${user.coins}\n`;
  inventoryText += `💎 <b>Самоцветы:</b> ${user.gems}`;
  
  await ctx.reply(
    inventoryText,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🍎 Использовать предмет', 'use_item')],
        [Markup.button.callback('🏪 В магазин', 'go_shop')]
      ])
    }
  );
});

bot.hears('🏪 Магазин', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  let shopText = `🏪 <b>Магазин</b> | 💰 <b>Монеты:</b> ${user.coins}\n\n`;
  
  defaultItems.forEach(item => {
    shopText += `${getItemEmoji(item.type)} <b>${item.name}</b>\n`;
    shopText += `   🏷️ Цена: ${item.price} монет\n`;
    shopText += `   📊 Редкость: ${item.rarity}\n`;
    shopText += `   📝 ${item.effect}\n\n`;
  });
  
  await ctx.reply(
    shopText,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🍎 Морковь (5)', 'buy_1'),
          Markup.button.callback('🍎 Яблоко (10)', 'buy_2')
        ],
        [
          Markup.button.callback('🌱 Семена (10)', 'buy_7'),
          Markup.button.callback('⚔️ Меч (30)', 'buy_4')
        ],
        [
          Markup.button.callback('🛡️ Броня (100)', 'buy_5'),
          Markup.button.callback('🔑 Ключ (100)', 'buy_6')
        ]
      ])
    }
  );
});

bot.hears('ℹ️ Помощь', async (ctx) => {
  await ctx.reply(
    `🎮 <b>Pet Arena - быстрые команды:</b>\n\n` +
    `/start - Начать игру\n` +
    `/pet - Посмотреть питомца\n` +
    `/battle - Начать бой\n` +
    `/garden - Открыть сад\n` +
    `/shop - Открыть магазин\n` +
    `/inventory - Открыть инвентарь\n\n` +
    `<i>Или используйте кнопки меню! 🎯</i>`,
    { 
      parse_mode: 'HTML',
      ...mainKeyboard 
    }
  );
});

bot.hears('⬅️ Назад', async (ctx) => {
  await ctx.reply('Главное меню:', mainKeyboard);
});

// ==================== CALLBACK ОБРАБОТЧИКИ ====================
bot.action('action_feed', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  // Ищем еду в инвентаре
  const foodIndex = user.inventory.findIndex(inv => {
    const item = defaultItems.find(i => i.id === inv.itemId);
    return item && item.type === 'food';
  });
  
  if (foodIndex === -1) {
    await ctx.answerCbQuery('❌ Нет еды в инвентаре!');
    return;
  }
  
  // Используем еду
  const foodItem = user.inventory[foodIndex];
  if (foodItem.quantity === 1) {
    user.inventory.splice(foodIndex, 1);
  } else {
    foodItem.quantity -= 1;
  }
  
  // Кормим питомца
  user.pet.hunger = Math.min(100, user.pet.hunger + 30);
  user.pet.mood = Math.min(100, user.pet.mood + 10);
  
  await ctx.answerCbQuery('✅ Питомец покормлен!');
  await ctx.editMessageText(
    `🍎 <b>Питомец покормлен!</b>\n\n` +
    `🍖 <b>Голод:</b> ${Math.round(user.pet.hunger)}% (+30)\n` +
    `😊 <b>Настроение:</b> ${Math.round(user.pet.mood)}% (+10)\n\n` +
    `<i>Еды осталось: ${foodItem.quantity || 0}</i>`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👈 Назад к питомцу', 'back_to_pet')]
      ])
    }
  );
});

bot.action('action_play', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  user.pet.mood = Math.min(100, user.pet.mood + 20);
  user.pet.energy = Math.max(0, user.pet.energy - 15);
  
  await ctx.answerCbQuery('✅ Поиграли с питомцем!');
  await ctx.editMessageText(
    `🎮 <b>Поиграли с питомцем!</b>\n\n` +
    `😊 <b>Настроение:</b> ${Math.round(user.pet.mood)}% (+20)\n` +
    `⚡ <b>Энергия:</b> ${Math.round(user.pet.energy)}% (-15)\n\n` +
    `<i>Питомец доволен! 🐾</i>`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👈 Назад к питомцу', 'back_to_pet')]
      ])
    }
  );
});

bot.action('action_sleep', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  user.pet.energy = Math.min(100, user.pet.energy + 40);
  user.pet.hunger = Math.max(0, user.pet.hunger - 10);
  
  await ctx.answerCbQuery('✅ Питомец поспал!');
  await ctx.editMessageText(
    `💤 <b>Питомец поспал!</b>\n\n` +
    `⚡ <b>Энергия:</b> ${Math.round(user.pet.energy)}% (+40)\n` +
    `🍖 <b>Голод:</b> ${Math.round(user.pet.hunger)}% (-10)\n\n` +
    `<i>Питомец отдохнул! 😴</i>`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👈 Назад к питомцу', 'back_to_pet')]
      ])
    }
  );
});

bot.action(/plant_(\d+)/, async (ctx) => {
  const itemId = parseInt(ctx.match[1]);
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  
  // Находим свободный слот
  const freeSlotIndex = user.garden.slots.findIndex(slot => slot === null);
  
  if (freeSlotIndex === -1) {
    await ctx.answerCbQuery('❌ Нет свободных слотов!');
    return;
  }
  
  // Проверяем наличие семян
  const seedIndex = user.inventory.findIndex(inv => inv.itemId === itemId);
  if (seedIndex === -1) {
    await ctx.answerCbQuery('❌ Семена не найдены!');
    return;
  }
  
  // Используем семена
  if (user.inventory[seedIndex].quantity === 1) {
    user.inventory.splice(seedIndex, 1);
  } else {
    user.inventory[seedIndex].quantity -= 1;
  }
  
  // Сажаем растение
  const item = defaultItems.find(i => i.id === itemId);
  user.garden.slots[freeSlotIndex] = item.name;
  user.garden.plantedAt[freeSlotIndex + 1] = Date.now();
  
  await ctx.answerCbQuery('✅ Растение посажено!');
  await ctx.editMessageText(
    `🌱 <b>${item.name} посажены!</b>\n\n` +
    `<i>Слот ${freeSlotIndex + 1} занят.\n` +
    `Урожай будет готов через 2 часа! ⏳</i>`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👈 Назад к саду', 'back_to_garden')]
      ])
    }
  );
});

bot.action(/buy_(\d+)/, async (ctx) => {
  const itemId = parseInt(ctx.match[1]);
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const item = defaultItems.find(i => i.id === itemId);
  
  if (!item) {
    await ctx.answerCbQuery('❌ Предмет не найден!');
    return;
  }
  
  if (user.coins < item.price) {
    await ctx.answerCbQuery(`❌ Недостаточно монет! Нужно: ${item.price}`);
    return;
  }
  
  // Покупка
  user.coins -= item.price;
  
  // Добавляем в инвентарь
  const existingItem = user.inventory.find(inv => inv.itemId === itemId);
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    user.inventory.push({ itemId: itemId, quantity: 1 });
  }
  
  await ctx.answerCbQuery(`✅ Куплено: ${item.name}`);
  await ctx.editMessageText(
    `🛒 <b>Успешная покупка!</b>\n\n` +
    `${getItemEmoji(item.type)} <b>${item.name}</b>\n` +
    `🏷️ <b>Цена:</b> ${item.price} монет\n` +
    `💰 <b>Осталось монет:</b> ${user.coins}\n\n` +
    `<i>Предмет добавлен в инвентарь! 🎒</i>`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Продолжить покупки', 'continue_shopping')],
        [Markup.button.callback('👈 В меню', 'back_to_main')]
      ])
    }
  );
});

// Навигационные callback
bot.action('back_to_pet', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  user.pet = updatePetStats(user.pet);
  
  const pet = user.pet;
  
  await ctx.editMessageText(
    `🐾 <b>${pet.name}</b> (${pet.type})\n\n` +
    `📊 <b>Уровень:</b> ${pet.level} | <b>Опыт:</b> ${pet.exp}/${pet.level * 100}\n\n` +
    `❤️ <b>Здоровье:</b> ${getStatusEmoji(pet.health)} ${Math.round(pet.health)}%\n` +
    `🍖 <b>Голод:</b> ${getStatusEmoji(pet.hunger)} ${Math.round(pet.hunger)}%\n` +
    `⚡ <b>Энергия:</b> ${getStatusEmoji(pet.energy)} ${Math.round(pet.energy)}%\n` +
    `😊 <b>Настроение:</b> ${getStatusEmoji(pet.mood)} ${Math.round(pet.mood)}%`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🍎 Покормить', 'action_feed'),
          Markup.button.callback('🎮 Поиграть', 'action_play')
        ],
        [
          Markup.button.callback('💤 Усыпить', 'action_sleep'),
          Markup.button.callback('🏋️ Тренировать', 'action_train')
        ]
      ])
    }
  );
});

bot.action('back_to_garden', async (ctx) => {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const garden = user.garden;
  
  let gardenText = '🌱 <b>Ваш сад:</b>\n\n';
  
  garden.slots.forEach((slot, index) => {
    const slotNum = index + 1;
    if (slot) {
      const plantedTime = garden.plantedAt[slotNum] || Date.now();
      const hoursPassed = (Date.now() - plantedTime) / (1000 * 60 * 60);
      
      if (hoursPassed >= 2) {
        gardenText += `${slotNum}. ${slot} 🌾 <i>(готово к сбору!)</i>\n`;
      } else {
        const timeLeft = Math.max(0, 2 - hoursPassed);
        gardenText += `${slotNum}. ${slot} ⏳ <i>(осталось: ${timeLeft.toFixed(1)}ч)</i>\n`;
      }
    } else {
      gardenText += `${slotNum}. 🌫️ <i>Пусто</i>\n`;
    }
  });
  
  await ctx.editMessageText(
    gardenText,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🌱 Посадить семена', 'show_seeds')],
        [Markup.button.callback('🌾 Собрать урожай', 'harvest_now')]
      ])
    }
  );
});

bot.action('back_to_main', async (ctx) => {
  await ctx.editMessageText('Главное меню:', mainKeyboard);
});

// ==================== ФУНКЦИИ БОЯ ====================
async function startBattle(ctx, difficulty) {
  const user = getOrCreateUser(ctx.from.id, ctx.from.username);
  const pet = user.pet;
  
  // Проверяем здоровье питомца
  if (pet.health <= 0) {
    await ctx.reply(
      '💀 <b>Ваш питомец без сознания!</b>\n\n' +
      '<i>Дайте ему отдохнуть или используйте лечебные предметы.</i>',
      { parse_mode: 'HTML', ...battleKeyboard }
    );
    return;
  }
  
  // Настройки боя в зависимости от сложности
  const battleSettings = {
    easy: { 
      aiHealth: 50, 
      aiAttack: 8, 
      minReward: 10, 
      maxReward: 20,
      winChance: 0.8
    },
    medium: { 
      aiHealth: 80, 
      aiAttack: 12, 
      minReward: 20, 
      maxReward: 40,
      winChance: 0.6
    },
    hard: { 
      aiHealth: 120, 
      aiAttack: 18, 
      minReward: 40, 
      maxReward: 80,
      winChance: 0.4
    }
  };
  
  const settings = battleSettings[difficulty];
  
  // Симуляция боя
  let playerHealth = pet.health;
  let aiHealth = settings.aiHealth;
  let battleLog = [`⚔️ <b>Бой начался!</b> (${difficulty})`];
  
  // Ходы боя (3-5 раундов)
  const rounds = Math.floor(Math.random() * 3) + 3;
  
  for (let i = 1; i <= rounds; i++) {
    // Игрок атакует
    const playerDamage = Math.floor(pet.attack * (0.8 + Math.random() * 0.4));
    aiHealth -= playerDamage;
    battleLog.push(`\n<b>Раунд ${i}:</b> Вы нанесли ${playerDamage} урона!`);
    
    if (aiHealth <= 0) break;
    
    // ИИ атакует
    const aiDamage = Math.floor(settings.aiAttack * (0.8 + Math.random() * 0.4));
    playerHealth -= aiDamage;
    battleLog.push(`Противник нанес ${aiDamage} урона!`);
    
    if (playerHealth <= 0) break;
  }
  
  const win = playerHealth > 0 && aiHealth <= 0;
  
  // Обновляем здоровье питомца
  pet.health = Math.max(0, playerHealth);
  
  if (win) {
    // Награда за победу
    const reward = Math.floor(Math.random() * (settings.maxReward - settings.minReward + 1)) + settings.minReward;
    const expReward = difficulty === 'easy' ? 5 : difficulty === 'medium' ? 10 : 20;
    
    user.coins += reward;
    pet.exp += expReward;
    
    // Проверка повышения уровня
    const expNeeded = pet.level * 100;
    if (pet.exp >= expNeeded) {
      pet.level += 1;
      pet.exp = 0;
      pet.attack += 3;
      pet.defense += 2;
      pet.health = 100;
      battleLog.push(`\n🎉 <b>Уровень повышен! Теперь уровень ${pet.level}!</b>`);
    }
    
    // Шанс на дроп предмета
    if (Math.random() < 0.3) {
      const commonItems = defaultItems.filter(item => item.rarity === 'common');
      const randomItem = commonItems[Math.floor(Math.random() * commonItems.length)];
      
      const existingItem = user.inventory.find(inv => inv.itemId === randomItem.id);
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        user.inventory.push({ itemId: randomItem.id, quantity: 1 });
      }
      
      battleLog.push(`🎁 <b>Получен предмет:</b> ${randomItem.name}!`);
    }
    
    battleLog.push(`\n💰 <b>Награда:</b> +${reward} монет`);
    battleLog.push(`⭐ <b>Опыт:</b> +${expReward}`);
    
  } else {
    battleLog.push(`\n💀 <b>Поражение!</b>`);
    // Минимальное здоровье после поражения
    pet.health = Math.max(10, pet.health);
    
    // Небольшая награда за участие
    const participationReward = Math.floor(reward / 4);
    user.coins += participationReward;
    battleLog.push(`\n💸 <b>Утешительная награда:</b> +${participationReward} монет`);
  }
  
  // Сохраняем историю боя
  user.battles.push({
    date: Date.now(),
    difficulty: difficulty,
    win: win,
    reward: reward
  });
  
  await ctx.reply(
    battleLog.join('\n') + `\n\n❤️ <b>Осталось здоровья:</b> ${Math.round(pet.health)}%\n\n` +
    `<i>${win ? 'Отличная работа! Продолжайте в том же духе! 🎯' : 'Не расстраивайтесь! Попробуйте еще раз! 💪'}</i>`,
    { 
      parse_mode: 'HTML',
      ...battleKeyboard 
    }
  );
}

// ==================== ЗАПУСК БОТА ====================
bot.launch()
  .then(() => {
    console.log('✅ Telegram бот успешно запущен!');
    console.log(`✅ Всего пользователей в памяти: ${users.size}`);
  })
  .catch(err => {
    console.error('❌ Ошибка запуска бота:', err);
  });

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Остановка бота...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('🛑 Остановка бота...');
  bot.stop('SIGTERM');
  process.exit(0);
});

console.log('🚀 Бот запускается...');
console.log('📊 Используется хранение данных в памяти');
console.log('🔗 Health endpoint: /health');
