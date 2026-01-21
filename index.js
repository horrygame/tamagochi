const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const fs = require('fs');

// Загрузка переменных окружения
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 0;

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Инициализация БД
const db = new Database('data/tamagochi.db', { verbose: console.log });
initDatabase();

// Запуск keep-alive
require('./keep-alive');

// Express сервер для health checks
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// ==================== ИНИЦИАЛИЗАЦИЯ БД ====================
function initDatabase() {
  // Создаем папку data если её нет
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }

  // Таблица пользователей
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      coins INTEGER DEFAULT 100,
      gems INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Таблица питомцев
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
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
      character TEXT DEFAULT 'friendly',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  // Таблица садов
  db.prepare(`
    CREATE TABLE IF NOT EXISTS gardens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      slot1 TEXT,
      slot2 TEXT,
      slot3 TEXT,
      slot4 TEXT,
      slot5 TEXT,
      slot6 TEXT,
      planted_at TEXT DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  // Таблица предметов
  db.prepare(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      rarity TEXT NOT NULL,
      effect TEXT NOT NULL,
      price INTEGER DEFAULT 0,
      sell_price INTEGER DEFAULT 0,
      min_level INTEGER DEFAULT 1
    )
  `).run();

  // Таблица инвентаря
  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )
  `).run();

  // Таблица снаряжения
  db.prepare(`
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id INTEGER NOT NULL,
      slot TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )
  `).run();

  // Таблица истории боев
  db.prepare(`
    CREATE TABLE IF NOT EXISTS battle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      result TEXT NOT NULL,
      opponent_type TEXT,
      reward TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  // Заполняем базовые предметы
  seedItems();
  console.log('Database initialized');
}

function seedItems() {
  const items = [
    // Еда
    ['Морковь', 'food', 'common', '{"hunger":20}', 5, 2, 1],
    ['Яблоко', 'food', 'common', '{"hunger":30,"mood":5}', 10, 5, 1],
    ['Золотое яблоко', 'food', 'rare', '{"hunger":50,"health":20,"mood":15}', 50, 25, 5],
    
    // Снаряжение
    ['Деревянный меч', 'equipment', 'common', '{"attack":5}', 30, 15, 1],
    ['Железная броня', 'equipment', 'uncommon', '{"defense":10}', 100, 50, 5],
    ['Чешуя дракона', 'equipment', 'epic', '{"attack":15,"defense":10,"health":20}', 500, 250, 10],
    
    // Ключи
    ['Обычный ключ', 'key', 'common', '{}', 100, 20, 1],
    ['Редкий ключ', 'key', 'rare', '{}', 300, 60, 5],
    ['Эпический ключ', 'key', 'epic', '{}', 1000, 200, 10],
    
    // Семена для сада
    ['Семена моркови', 'seed', 'common', '{"grow_time":2,"yield":"carrot"}', 10, 3, 1],
    ['Саженец яблони', 'seed', 'uncommon', '{"grow_time":6,"yield":"apple"}', 50, 15, 3],
    ['Золотое семя', 'seed', 'rare', '{"grow_time":24,"yield":"golden_apple"}', 200, 50, 8]
  ];

  const check = db.prepare('SELECT COUNT(*) as count FROM items').get();
  if (check.count === 0) {
    const insert = db.prepare(`
      INSERT INTO items (name, type, rarity, effect, price, sell_price, min_level) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insert.run(...item);
      }
    });
    
    insertMany(items);
    console.log('Items seeded');
  }
}

// ==================== КЛАВИАТУРЫ ====================
const keyboards = {
  main: Markup.keyboard([
    ['🐶 Мой питомец', '⚔️ Бой'],
    ['🌱 Сад', '🎒 Инвентарь'],
    ['🏪 Магазин', '🏆 Достижения']
  ]).resize(),

  garden: Markup.keyboard([
    ['🌱 Посадить растение', '🌾 Собрать урожай'],
    ['⬅️ Назад']
  ]).resize(),

  battle: Markup.keyboard([
    ['⚔️ Начать бой', '🏆 История боев'],
    ['⬅️ Назад']
  ]).resize(),

  inventory: Markup.keyboard([
    ['🍎 Использовать предмет', '🔧 Экипировать'],
    ['🗑️ Продать', '⬅️ Назад']
  ]).resize(),

  back: Markup.keyboard([['⬅️ Назад']]).resize()
};

// ==================== СИСТЕМА ПИТОМЦЕВ ====================
function getOrCreateUser(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
  
  if (!user) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, coins, gems) 
      VALUES (?, ?, 100, 10)
    `).run(userId, username);
    
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    
    // Создаем сад для пользователя
    db.prepare('INSERT INTO gardens (user_id) VALUES (?)').run(user.id);
  }
  
  return user;
}

function getOrCreatePet(userId) {
  let pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(userId);
  
  if (!pet) {
    // Создаем нового питомца
    const petTypes = ['дракон', 'робот', 'кот', 'волк', 'птица'];
    const petType = petTypes[Math.floor(Math.random() * petTypes.length)];
    
    db.prepare(`
      INSERT INTO pets (user_id, name, type, hunger, energy, mood, health) 
      VALUES (?, ?, ?, 50, 80, 70, 100)
    `).run(userId, `Мой ${petType}`, petType);
    
    pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(userId);
  }
  
  return pet;
}

function updatePetStats(petId) {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(petId);
  const now = new Date();
  const lastUpdate = new Date(pet.last_update);
  const hoursPassed = (now - lastUpdate) / (1000 * 60 * 60);
  
  if (hoursPassed > 0) {
    let newHunger = Math.max(0, pet.hunger - (5 * hoursPassed));
    let newEnergy = Math.min(100, pet.energy + (2 * hoursPassed));
    let newMood = Math.max(0, pet.mood - (3 * hoursPassed));
    let newHealth = pet.health;
    
    if (newHunger < 20) {
      newHealth = Math.max(0, newHealth - (2 * hoursPassed));
    }
    
    db.prepare(`
      UPDATE pets 
      SET hunger = ?, energy = ?, mood = ?, health = ?, last_update = ?
      WHERE id = ?
    `).run(newHunger, newEnergy, newMood, newHealth, now.toISOString(), petId);
  }
}

// ==================== СИСТЕМА САДА ====================
function getGarden(userId) {
  return db.prepare('SELECT * FROM gardens WHERE user_id = ?').get(userId);
}

function plantSeed(userId, slot, seedType) {
  const garden = getGarden(userId);
  const slotName = `slot${slot}`;
  
  // Проверяем свободен ли слот
  if (garden[slotName]) {
    return { success: false, message: 'Слот уже занят!' };
  }
  
  // Получаем информацию о семени
  const seed = db.prepare('SELECT * FROM items WHERE name LIKE ? AND type = ?').get(`%${seedType}%`, 'seed');
  if (!seed) {
    return { success: false, message: 'Такого семени нет!' };
  }
  
  // Проверяем деньги
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (user.coins < seed.price) {
    return { success: false, message: `Недостаточно монет! Нужно: ${seed.price}` };
  }
  
  // Вычитаем деньги
  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(seed.price, userId);
  
  // Сажаем растение
  const plantedAt = JSON.parse(garden.planted_at || '{}');
  plantedAt[slotName] = new Date().toISOString();
  
  db.prepare(`
    UPDATE gardens 
    SET ${slotName} = ?, planted_at = ?
    WHERE user_id = ?
  `).run(`${seedType}:1`, JSON.stringify(plantedAt), userId);
  
  return { 
    success: true, 
    message: `Посажено ${seed.name} в слот ${slot}! Собирать урожай можно через ${JSON.parse(seed.effect).grow_time} часов.`
  };
}

function harvestGarden(userId) {
  const garden = getGarden(userId);
  const plantedAt = JSON.parse(garden.planted_at || '{}');
  const harvested = [];
  
  for (let slot = 1; slot <= 6; slot++) {
    const slotName = `slot${slot}`;
    const plantData = garden[slotName];
    
    if (plantData && plantedAt[slotName]) {
      const [plantType, level] = plantData.split(':');
      const plantTime = new Date(plantedAt[slotName]);
      const now = new Date();
      const hoursGrown = (now - plantTime) / (1000 * 60 * 60);
      
      // Время роста в зависимости от типа растения
      const growTimes = {
        'carrot': 2,
        'apple': 6,
        'golden_apple': 24
      };
      
      if (hoursGrown >= (growTimes[plantType] || 24)) {
        // Собираем урожай
        const yields = {
          'carrot': { type: 'food', name: 'Морковь', quantity: Math.floor(Math.random() * 3) + 1 * level },
          'apple': { type: 'food', name: 'Яблоко', quantity: Math.floor(Math.random() * 4) + 2 * level },
          'golden_apple': { type: 'food', name: 'Золотое яблоко', quantity: Math.floor(Math.random() * 2) + 1 * level }
        };
        
        const yieldInfo = yields[plantType];
        if (yieldInfo) {
          // Добавляем предмет в инвентарь
          const item = db.prepare('SELECT * FROM items WHERE name = ?').get(yieldInfo.name);
          if (item) {
            let inventory = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, item.id);
            
            if (inventory) {
              db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(yieldInfo.quantity, inventory.id);
            } else {
              db.prepare('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)')
                .run(userId, item.id, yieldInfo.quantity);
            }
            
            harvested.push(`${yieldInfo.name} x${yieldInfo.quantity}`);
            
            // Повышаем уровень растения
            const newLevel = Math.min(10, parseInt(level) + 1);
            plantedAt[slotName] = new Date().toISOString();
            
            db.prepare(`UPDATE gardens SET ${slotName} = ? WHERE user_id = ?`)
              .run(`${plantType}:${newLevel}`, userId);
          }
        }
      }
    }
  }
  
  // Обновляем время посадки
  db.prepare('UPDATE gardens SET planted_at = ? WHERE user_id = ?')
    .run(JSON.stringify(plantedAt), userId);
  
  return harvested;
}

// ==================== СИСТЕМА БОЕВ ====================
class BattleAI {
  constructor(difficulty = 'easy') {
    this.difficulty = difficulty;
    this.personalities = ['aggressive', 'defensive', 'balanced', 'cunning'];
    this.personality = this.personalities[Math.floor(Math.random() * this.personalities.length)];
  }
  
  chooseAction(playerPet, aiPet, turn) {
    const weights = { attack: 0.4, special: 0.3, defend: 0.3 };
    
    switch (this.personality) {
      case 'aggressive':
        weights.attack = 0.6;
        weights.special = 0.3;
        weights.defend = 0.1;
        break;
      case 'defensive':
        weights.attack = 0.2;
        weights.special = 0.2;
        weights.defend = 0.6;
        break;
      case 'cunning':
        if (playerPet.health < 30) {
          weights.attack = 0.8;
          weights.special = 0.2;
          weights.defend = 0.0;
        }
        break;
    }
    
    if (this.difficulty === 'hard') {
      weights.special += 0.1;
    } else if (this.difficulty === 'easy') {
      weights.defend += 0.2;
    }
    
    const actions = Object.keys(weights);
    const probs = Object.values(weights);
    const total = probs.reduce((a, b) => a + b, 0);
    const rand = Math.random() * total;
    
    let cumulative = 0;
    for (let i = 0; i < actions.length; i++) {
      cumulative += probs[i];
      if (rand < cumulative) {
        return actions[i];
      }
    }
    
    return 'attack';
  }
}

function startBattle(userId) {
  const pet = getOrCreatePet(userId);
  updatePetStats(pet.id);
  
  // Создаем ИИ противника
  const difficulties = ['easy', 'normal', 'hard'];
  const weights = pet.level < 10 ? [0.5, 0.35, 0.15] : [0.2, 0.5, 0.3];
  const difficulty = weightedRandom(difficulties, weights);
  
  const aiNames = ['Дракон', 'Воин', 'Зверь', 'Страж', 'Рыцарь'];
  const aiName = `ИИ ${aiNames[Math.floor(Math.random() * aiNames.length)]}`;
  const aiTypes = ['дракон', 'робот', 'кот', 'волк'];
  const aiType = aiTypes[Math.floor(Math.random() * aiTypes.length)];
  
  const levelDiff = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
  const aiLevel = Math.max(1, pet.level + levelDiff);
  
  const aiPet = {
    name: aiName,
    type: aiType,
    level: aiLevel,
    health: 80 + (aiLevel * 5),
    attack: 10 + (aiLevel * 2),
    defense: 5 + aiLevel,
    speed: 8 + (aiLevel * 1.5)
  };
  
  const ai = new BattleAI(difficulty);
  
  return { pet, aiPet, ai, difficulty };
}

function calculateDamage(attacker, defender, action) {
  const baseDamage = {
    attack: attacker.attack * 0.8,
    special: attacker.attack * 1.5,
    defend: 0
  };
  
  if (!baseDamage[action]) return 0;
  
  let damage = Math.max(1, baseDamage[action] - (defender.defense * 0.3));
  
  // Критический удар
  if (Math.random() < 0.05) {
    damage *= 1.5;
  }
  
  // Влияние энергии (для игрока)
  if (attacker.energy) {
    damage *= (attacker.energy / 100);
  }
  
  return Math.round(damage * 10) / 10;
}

function getBattleRewards(userId, win, difficulty) {
  const baseCoins = Math.floor(Math.random() * 21) + 10; // 10-30
  const baseExp = Math.floor(Math.random() * 11) + 5; // 5-15
  
  let coins = win ? baseCoins * 2 : baseCoins;
  let exp = win ? baseExp * 2 : baseExp;
  
  const rewards = { coins, exp };
  
  // Шанс на дроп предмета
  const dropChances = { easy: 0.1, normal: 0.25, hard: 0.5 };
  const dropChance = dropChances[difficulty] || 0.1;
  
  if (win && Math.random() < dropChance) {
    const rarityWeights = {
      easy: { common: 0.7, uncommon: 0.3 },
      normal: { common: 0.5, uncommon: 0.35, rare: 0.15 },
      hard: { common: 0.3, uncommon: 0.4, rare: 0.2, epic: 0.1 }
    };
    
    const weights = rarityWeights[difficulty] || rarityWeights.normal;
    const rarities = Object.keys(weights);
    const probs = Object.values(weights);
    
    const rarity = weightedRandom(rarities, probs);
    
    const item = db.prepare('SELECT * FROM items WHERE rarity = ? ORDER BY RANDOM() LIMIT 1').get(rarity);
    if (item) {
      rewards.item = item;
    }
  }
  
  // Шанс на ключ
  const keyChances = { easy: 0.05, normal: 0.1, hard: 0.2 };
  const keyChance = keyChances[difficulty] || 0.1;
  
  if (win && Math.random() < keyChance) {
    const keyItem = db.prepare('SELECT * FROM items WHERE type = ? AND name LIKE ? LIMIT 1').get('key', '%ключ%');
    if (keyItem) {
      rewards.key = keyItem;
    }
  }
  
  // Обновляем данные пользователя
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(rewards.coins, userId);
  
  // Обновляем опыт питомца
  const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(userId);
  let newExp = pet.exp + rewards.exp;
  let newLevel = pet.level;
  
  while (newExp >= newLevel * 100) {
    newExp -= newLevel * 100;
    newLevel++;
    
    // При повышении уровня улучшаем характеристики
    db.prepare(`
      UPDATE pets 
      SET level = level + 1, 
          attack = attack + 2,
          defense = defense + 1,
          health = health + 10,
          exp = ?
      WHERE id = ?
    `).run(newExp, pet.id);
  }
  
  // Сохраняем историю боя
  db.prepare(`
    INSERT INTO battle_history (user_id, result, opponent_type, reward) 
    VALUES (?, ?, ?, ?)
  `).run(userId, win ? 'win' : 'lose', difficulty, JSON.stringify(rewards));
  
  // Добавляем предметы в инвентарь
  if (rewards.item) {
    let inv = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, rewards.item.id);
    if (inv) {
      db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(inv.id);
    } else {
      db.prepare('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, 1)')
        .run(userId, rewards.item.id);
    }
  }
  
  if (rewards.key) {
    let inv = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, rewards.key.id);
    if (inv) {
      db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(inv.id);
    } else {
      db.prepare('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, 1)')
        .run(userId, rewards.key.id);
    }
  }
  
  return rewards;
}

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const rand = Math.random() * total;
  
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (rand < cumulative) {
      return items[i];
    }
  }
  
  return items[0];
}

// ==================== ИНТЕРФЕЙС БОТА ====================
bot.start(async (ctx) => {
  const user = getOrCreateUser(ctx);
  const pet = getOrCreatePet(user.id);
  
  await ctx.reply(
    `🎮 Добро пожаловать в Pet Arena!\n\n` +
    `👤 Ваш профиль создан!\n` +
    `💰 Монеты: ${user.coins}\n` +
    `💎 Самоцветы: ${user.gems}\n\n` +
    `🐾 Ваш питомец: ${pet.name}\n` +
    `📊 Уровень: ${pet.level}\n\n` +
    `Используйте кнопки ниже для управления:`,
    keyboards.main
  );
});

bot.hears('🐶 Мой питомец', async (ctx) => {
  const user = getOrCreateUser(ctx);
  const pet = getOrCreatePet(user.id);
  updatePetStats(pet.id);
  
  // Обновляем питомца после обновления статистики
  const updatedPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(pet.id);
  
  const statusEmoji = (value) => {
    if (value >= 80) return '🟢';
    if (value >= 50) return '🟡';
    if (value >= 30) return '🟠';
    return '🔴';
  };
  
  await ctx.reply(
    `🐾 ${updatedPet.name} (${updatedPet.type})\n` +
    `📊 Уровень: ${updatedPet.level} | Опыт: ${updatedPet.exp}/${updatedPet.level * 100}\n\n` +
    `❤️ Здоровье: ${statusEmoji(updatedPet.health)} ${updatedPet.health.toFixed(1)}/100\n` +
    `🍖 Голод: ${statusEmoji(updatedPet.hunger)} ${updatedPet.hunger.toFixed(1)}/100\n` +
    `⚡ Энергия: ${statusEmoji(updatedPet.energy)} ${updatedPet.energy.toFixed(1)}/100\n` +
    `😊 Настроение: ${statusEmoji(updatedPet.mood)} ${updatedPet.mood.toFixed(1)}/100\n\n` +
    `⚔️ Атака: ${updatedPet.attack.toFixed(1)}\n` +
    `🛡️ Защита: ${updatedPet.defense.toFixed(1)}\n` +
    `🏃 Скорость: ${updatedPet.speed.toFixed(1)}`,
    keyboards.back
  );
});

bot.hears('⚔️ Бой', async (ctx) => {
  await ctx.reply(
    '⚔️ Арена битв!\n\n' +
    'Сражайтесь с ИИ противниками, получайте опыт и награды!\n' +
    'Чем выше сложность, тем лучше награды!',
    keyboards.battle
  );
});

bot.hears('⚔️ Начать бой', async (ctx) => {
  const user = getOrCreateUser(ctx);
  const battle = startBattle(user.id);
  
  // Сохраняем информацию о текущем бое в сессии
  ctx.session = ctx.session || {};
  ctx.session.currentBattle = {
    userId: user.id,
    playerPet: battle.pet,
    aiPet: battle.aiPet,
    ai: battle.ai,
    difficulty: battle.difficulty,
    turn: 1,
    battleLog: []
  };
  
  await ctx.reply(
    `⚔️ Начинается бой!\n\n` +
    `👤 Вы: ${battle.pet.name}\n` +
    `❤️ ${battle.pet.health.toFixed(1)} | ⚔️ ${battle.pet.attack.toFixed(1)}\n\n` +
    `🤖 Противник: ${battle.aiPet.name}\n` +
    `❤️ ${battle.aiPet.health} | ⚔️ ${battle.aiPet.attack}\n\n` +
    `📊 Сложность: ${battle.difficulty}\n\n` +
    `Выберите действие:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🗡️ Атака', 'action_attack'),
        Markup.button.callback('💥 Особое', 'action_special')
      ],
      [
        Markup.button.callback('🛡️ Защита', 'action_defend'),
        Markup.button.callback('🍎 Предмет', 'action_item')
      ]
    ])
  );
});

bot.hears('🌱 Сад', async (ctx) => {
  const user = getOrCreateUser(ctx);
  const garden = getGarden(user.id);
  
  let gardenText = '🌱 Ваш сад:\n\n';
  for (let i = 1; i <= 6; i++) {
    const slot = garden[`slot${i}`];
    if (slot) {
      const [plant, level] = slot.split(':');
      gardenText += `${i}. ${getPlantEmoji(plant)} ${plant} (ур. ${level})\n`;
    } else {
      gardenText += `${i}. 🌫️ Пусто\n`;
    }
  }
  
  await ctx.reply(gardenText, keyboards.garden);
});

bot.hears('🌱 Посадить растение', async (ctx) => {
  await ctx.reply(
    'Выберите слот для посадки:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Слот 1', 'plant_1'),
        Markup.button.callback('Слот 2', 'plant_2'),
        Markup.button.callback('Слот 3', 'plant_3')
      ],
      [
        Markup.button.callback('Слот 4', 'plant_4'),
        Markup.button.callback('Слот 5', 'plant_5'),
        Markup.button.callback('Слот 6', 'plant_6')
      ]
    ])
  );
});

bot.hears('🌾 Собрать урожай', async (ctx) => {
  const user = getOrCreateUser(ctx);
  const harvested = harvestGarden(user.id);
  
  if (harvested.length > 0) {
    await ctx.reply(
      `🌾 Урожай собран!\n\n` +
      `Получено:\n${harvested.join('\n')}`,
      keyboards.back
    );
  } else {
    await ctx.reply(
      '🌱 Ещё ничего не выросло. Подождите немного!',
      keyboards.back
    );
  }
});

bot.hears('🎒 Инвентарь', async (ctx) => {
  const user = getOrCreateUser(ctx);
  
  const inventory = db.prepare(`
    SELECT i.*, inv.quantity 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ? 
    ORDER BY i.rarity, i.name
  `).all(user.id);
  
  if (inventory.length === 0) {
    await ctx.reply('🎒 Ваш инвентарь пуст!', keyboards.inventory);
    return;
  }
  
  let inventoryText = '🎒 Ваш инвентарь:\n\n';
  const itemsByType = {};
  
  inventory.forEach(item => {
    if (!itemsByType[item.type]) {
      itemsByType[item.type] = [];
    }
    itemsByType[item.type].push(item);
  });
  
  for (const [type, items] of Object.entries(itemsByType)) {
    inventoryText += `${getTypeEmoji(type)} ${type.toUpperCase()}:\n`;
    items.forEach(item => {
      inventoryText += `  ${getRarityEmoji(item.rarity)} ${item.name} x${item.quantity}\n`;
    });
    inventoryText += '\n';
  }
  
  await ctx.reply(inventoryText, keyboards.inventory);
});

bot.hears('⬅️ Назад', async (ctx) => {
  await ctx.reply('Главное меню:', keyboards.main);
});

bot.hears('🏪 Магазин', async (ctx) => {
  const user = getOrCreateUser(ctx);
  
  const items = db.prepare(`
    SELECT * FROM items 
    WHERE type IN ('food', 'seed', 'key') 
    ORDER BY type, price
    LIMIT 20
  `).all();
  
  let shopText = `🏪 Магазин | Монеты: ${user.coins}\n\n`;
  
  const itemsByType = {};
  items.forEach(item => {
    if (!itemsByType[item.type]) {
      itemsByType[item.type] = [];
    }
    itemsByType[item.type].push(item);
  });
  
  for (const [type, typeItems] of Object.entries(itemsByType)) {
    shopText += `${getTypeEmoji(type)} ${type.toUpperCase()}:\n`;
    typeItems.forEach(item => {
      shopText += `  ${getRarityEmoji(item.rarity)} ${item.name} - ${item.price} монет\n`;
    });
    shopText += '\n';
  }
  
  await ctx.reply(
    shopText,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🍎 Купить еду', 'shop_food'),
        Markup.button.callback('🌱 Купить семена', 'shop_seeds')
      ],
      [
        Markup.button.callback('🔑 Купить ключи', 'shop_keys'),
        Markup.button.callback('📦 Открыть кейс', 'open_case')
      ]
    ])
  );
});

// ==================== CALLBACK ОБРАБОТЧИКИ ====================
bot.action(/action_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const battle = ctx.session?.currentBattle;
  
  if (!battle) {
    await ctx.answerCbQuery('Бой не найден!');
    return;
  }
  
  // Ход игрока
  let playerDamage = 0;
  let aiDamage = 0;
  let battleLog = [`Ход ${battle.turn}:`];
  
  // Игрок атакует
  if (action === 'attack' || action === 'special') {
    playerDamage = calculateDamage(battle.playerPet, battle.aiPet, action);
    battle.aiPet.health -= playerDamage;
    battleLog.push(`Вы нанесли ${playerDamage} урона!`);
  } else if (action === 'defend') {
    // Защита дает бонус к защите на следующий ход
    battleLog.push('Вы защищаетесь!');
  }
  
  // Проверяем не побежден ли ИИ
  if (battle.aiPet.health <= 0) {
    const rewards = getBattleRewards(battle.userId, true, battle.difficulty);
    
    await ctx.editMessageText(
      `🎉 ПОБЕДА!\n\n` +
      `Вы победили ${battle.aiPet.name}!\n\n` +
      `Награды:\n` +
      `💰 +${rewards.coins} монет\n` +
      `⭐ +${rewards.exp} опыта\n` +
      `${rewards.item ? `🎁 ${rewards.item.name}\n` : ''}` +
      `${rewards.key ? `🔑 ${rewards.key.name}\n` : ''}` +
      `\nПродолжайте в том же духе!`,
      keyboards.battle
    );
    
    delete ctx.session.currentBattle;
    return;
  }
  
  // Ход ИИ
  const aiAction = battle.ai.chooseAction(battle.playerPet, battle.aiPet, battle.turn);
  if (aiAction === 'attack' || aiAction === 'special') {
    aiDamage = calculateDamage(battle.aiPet, battle.playerPet, aiAction);
    battle.playerPet.health -= aiDamage;
    battleLog.push(`${battle.aiPet.name} нанес ${aiDamage} урона!`);
  }
  
  // Проверяем не проиграл ли игрок
  if (battle.playerPet.health <= 0) {
    const rewards = getBattleRewards(battle.userId, false, battle.difficulty);
    
    await ctx.editMessageText(
      `💀 ПОРАЖЕНИЕ!\n\n` +
      `${battle.aiPet.name} победил вас!\n\n` +
      `Награды:\n` +
      `💰 +${rewards.coins} монет\n` +
      `⭐ +${rewards.exp} опыта\n` +
      `\nНе сдавайтесь!`,
      keyboards.battle
    );
    
    delete ctx.session.currentBattle;
    return;
  }
  
  // Обновляем информацию о бое
  battle.turn++;
  battleLog.push(`\nВаше здоровье: ${battle.playerPet.health.toFixed(1)}`);
  battleLog.push(`Здоровье противника: ${battle.aiPet.health.toFixed(1)}`);
  
  ctx.session.currentBattle = battle;
  
  await ctx.editMessageText(
    `${battleLog.join('\n')}\n\n` +
    `Ход ${battle.turn}. Выберите действие:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🗡️ Атака', 'action_attack'),
        Markup.button.callback('💥 Особое', 'action_special')
      ],
      [
        Markup.button.callback('🛡️ Защита', 'action_defend'),
        Markup.button.callback('🍎 Предмет', 'action_item')
      ]
    ])
  );
  
  await ctx.answerCbQuery();
});

bot.action(/plant_(\d+)/, async (ctx) => {
  const slot = parseInt(ctx.match[1]);
  const user = getOrCreateUser(ctx);
  
  await ctx.editMessageText(
    `Выберите растение для слота ${slot}:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🥕 Морковь (2ч)', `plant_${slot}_carrot`),
        Markup.button.callback('🍎 Яблоня (6ч)', `plant_${slot}_apple`)
      ],
      [
        Markup.button.callback('🌟 Золотое семя (24ч)', `plant_${slot}_golden_apple`),
        Markup.button.callback('❌ Отмена', 'cancel_plant')
      ]
    ])
  );
});

bot.action(/plant_\d+_(.+)/, async (ctx) => {
  const slot = parseInt(ctx.match[1].split('_')[1]);
  const plantType = ctx.match[2];
  const user = getOrCreateUser(ctx);
  
  const result = plantSeed(user.id, slot, plantType);
  
  await ctx.editMessageText(
    result.message,
    keyboards.back
  );
  
  await ctx.answerCbQuery();
});

bot.action('open_case', async (ctx) => {
  const user = getOrCreateUser(ctx);
  
  // Проверяем наличие ключей
  const keys = db.prepare(`
    SELECT i.*, inv.quantity 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ? AND i.type = 'key'
  `).all(user.id);
  
  if (keys.length === 0) {
    await ctx.editMessageText(
      'У вас нет ключей для открытия кейсов!\nКлючи можно получить в боях или купить в магазине.',
      keyboards.main
    );
    return;
  }
  
  let keyboard = [];
  keys.forEach(key => {
    const rarityText = {
      'common': 'Обычный',
      'uncommon': 'Необычный', 
      'rare': 'Редкий',
      'epic': 'Эпический'
    }[key.rarity] || key.rarity;
    
    keyboard.push([
      Markup.button.callback(
        `${getRarityEmoji(key.rarity)} ${rarityText} кейс (x${key.quantity})`,
        `open_${key.rarity}`
      )
    ]);
  });
  
  keyboard.push([Markup.button.callback('❌ Отмена', 'cancel_open')]);
  
  await ctx.editMessageText(
    '🔑 Выберите кейс для открытия:',
    Markup.inlineKeyboard(keyboard)
  );
});

bot.action(/open_(.+)/, async (ctx) => {
  const rarity = ctx.match[1];
  const user = getOrCreateUser(ctx);
  
  // Находим ключ
  const key = db.prepare(`
    SELECT i.*, inv.id as inv_id, inv.quantity 
    FROM inventory inv 
    JOIN items i ON inv.item_id = i.id 
    WHERE inv.user_id = ? AND i.type = 'key' AND i.rarity = ?
    LIMIT 1
  `).get(user.id, rarity);
  
  if (!key || key.quantity < 1) {
    await ctx.answerCbQuery('Ключ не найден!');
    return;
  }
  
  // Используем ключ
  if (key.quantity === 1) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(key.inv_id);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(key.inv_id);
  }
  
  // Получаем награду
  const rewards = {
    common: { common: 0.7, uncommon: 0.25, rare: 0.05 },
    uncommon: { common: 0.5, uncommon: 0.4, rare: 0.1 },
    rare: { uncommon: 0.5, rare: 0.4, epic: 0.1 },
    epic: { rare: 0.4, epic: 0.5, legendary: 0.1 }
  };
  
  const rewardRarities = rewards[rarity] || rewards.common;
  const items = Object.keys(rewardRarities);
  const weights = Object.values(rewardRarities);
  
  const rewardRarity = weightedRandom(items, weights);
  
  // Выбираем случайный предмет выбранной редкости
  const rewardItem = db.prepare(`
    SELECT * FROM items 
    WHERE rarity = ? AND type != 'key'
    ORDER BY RANDOM() 
    LIMIT 1
  `).get(rewardRarity);
  
  if (rewardItem) {
    // Добавляем в инвентарь
    let inv = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ?').get(user.id, rewardItem.id);
    if (inv) {
      db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(inv.id);
    } else {
      db.prepare('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, 1)')
        .run(user.id, rewardItem.id);
    }
    
    await ctx.editMessageText(
      `🎁 Вы открыли ${rarity} кейс!\n\n` +
      `Получено: ${getRarityEmoji(rewardRarity)} ${rewardItem.name}\n\n` +
      `${getRarityEmoji(rewardRarity)} Редкость: ${rewardRarity}\n` +
      `📦 Тип: ${rewardItem.type}\n\n` +
      `Предмет добавлен в инвентарь!`,
      keyboards.main
    );
  }
  
  await ctx.answerCbQuery();
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getPlantEmoji(plant) {
  const emojis = {
    'carrot': '🥕',
    'apple': '🍎',
    'golden_apple': '🌟'
  };
  return emojis[plant] || '🌱';
}

function getTypeEmoji(type) {
  const emojis = {
    'food': '🍎',
    'equipment': '⚔️',
    'key': '🔑',
    'seed': '🌱',
    'consumable': '🧪'
  };
  return emojis[type] || '📦';
}

function getRarityEmoji(rarity) {
  const emojis = {
    'common': '⚪',
    'uncommon': '🟢',
    'rare': '🔵',
    'epic': '🟣',
    'legendary': '🟡'
  };
  return emojis[rarity] || '⚪';
}

// ==================== ЗАПУСК БОТА ====================
// Автоматическое обновление статистики питомцев каждый час
cron.schedule('0 * * * *', () => {
  console.log('Auto-updating pet stats...');
  const pets = db.prepare('SELECT id FROM pets').all();
  pets.forEach(pet => {
    updatePetStats(pet.id);
  });
});

// Уборка старых данных (оставляем только последние 100 записей в истории)
cron.schedule('0 0 * * *', () => {
  console.log('Cleaning old battle history...');
  db.prepare(`
    DELETE FROM battle_history 
    WHERE id NOT IN (
      SELECT id FROM battle_history 
      ORDER BY created_at DESC 
      LIMIT 100
    )
  `).run();
});

// Запуск бота
bot.launch()
  .then(() => {
    console.log('Bot started successfully!');
  })
  .catch(err => {
    console.error('Bot startup error:', err);
  });

// Graceful shutdown
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  db.close();
  process.exit(0);
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  db.close();
  process.exit(0);
});

module.exports = { bot, db };
