const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err);
  } else {
    console.log('✅ Подключено к SQLite базе данных');
    initDatabase();
  }
});

// ==================== ИНИЦИАЛИЗАЦИЯ БД ====================
function initDatabase() {
  // Создаем таблицы если их нет
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      coins INTEGER DEFAULT 100,
      gems INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS pets (
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
    )`,
    
    `CREATE TABLE IF NOT EXISTS gardens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      slot1 TEXT,
      slot2 TEXT,
      slot3 TEXT,
      planted_at TEXT DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      rarity TEXT DEFAULT 'common',
      price INTEGER DEFAULT 0
    )`,
    
    `CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  ];

  // Выполняем запросы последовательно
  let index = 0;
  function runNextQuery() {
    if (index < queries.length) {
      db.run(queries[index], (err) => {
        if (err) {
          console.error(`❌ Ошибка создания таблицы ${index + 1}:`, err);
        }
        index++;
        runNextQuery();
      });
    } else {
      seedItems();
    }
  }
  
  runNextQuery();
}

function seedItems() {
  db.get('SELECT COUNT(*) as count FROM items', (err, row) => {
    if (err) {
      console.error('❌ Ошибка проверки items:', err);
      return;
    }
    
    if (row.count === 0) {
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
      
      items.forEach(item => {
        stmt.run(item, (err) => {
          if (err) console.error('❌ Ошибка вставки предмета:', err);
        });
      });
      
      stmt.finalize();
      console.log('✅ Базовые предметы добавлены');
    }
  });
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getOrCreateUser(telegramId, username, callback) {
  db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, user) => {
    if (err) {
      console.error('❌ Ошибка получения пользователя:', err);
      callback(null);
      return;
    }
    
    if (!user) {
      db.run('INSERT INTO users (telegram_id, username) VALUES (?, ?)', [telegramId, username], function(err) {
        if (err) {
          console.error('❌ Ошибка создания пользователя:', err);
          callback(null);
          return;
        }
        
        const userId = this.lastID;
        
        // Создаем питомца
        db.run('INSERT INTO pets (user_id, name, type) VALUES (?, ?, ?)', 
          [userId, 'Мой дракончик', 'dragon'], (err) => {
            if (err) console.error('❌ Ошибка создания питомца:', err);
            
            // Создаем сад
            db.run('INSERT INTO gardens (user_id) VALUES (?)', [userId], (err) => {
              if (err) console.error('❌ Ошибка создания сада:', err);
              
              // Даем стартовые предметы
              db.get('SELECT id FROM items WHERE name = ?', ['Морковь'], (err, item) => {
                if (!err && item) {
                  db.run('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)',
                    [userId, item.id, 3]);
                }
                
                // Возвращаем пользователя
                db.get('SELECT * FROM users WHERE id = ?', [userId], (err, newUser) => {
                  callback(newUser);
                });
              });
            });
          });
      });
    } else {
      callback(user);
    }
  });
}

function getPet(userId, callback) {
  db.get('SELECT * FROM pets WHERE user_id = ?', [userId], (err, pet) => {
    if (err) {
      console.error('❌ Ошибка получения питомца:', err);
      callback(null);
    } else {
      callback(pet);
    }
  });
}

function updatePetStats(petId) {
  db.get('SELECT * FROM pets WHERE id = ?', [petId], (err, pet) => {
    if (err || !pet) return;
    
    const newHunger = Math.max(0, pet.hunger - 0.5);
    const newMood = Math.max(0, pet.mood - 0.3);
    const newEnergy = Math.min(100, pet.energy + 1);
    
    db.run('UPDATE pets SET hunger = ?, mood = ?, energy = ? WHERE id = ?',
      [newHunger, newMood, newEnergy, petId]);
  });
}

// ==================== КОМАНДЫ БОТА ====================
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  
  getOrCreateUser(telegramId, username, (user) => {
    if (!user) {
      ctx.reply('❌ Ошибка создания профиля. Попробуйте еще раз.');
      return;
    }
    
    getPet(user.id, (pet) => {
      if (!pet) {
        ctx.reply('❌ Ошибка создания питомца. Попробуйте еще раз.');
        return;
      }
      
      ctx.reply(
        `🎮 Добро пожаловать в Pet Arena!\n\n` +
        `🐾 Ваш питомец ${pet.name} готов к приключениям!\n` +
        `💰 Монет: ${user.coins}\n` +
        `💎 Самоцветов: ${user.gems}\n\n` +
        `Выберите действие:`,
        mainKeyboard
      );
    });
  });
});

// ==================== КЛАВИАТУРЫ ====================
const mainKeyboard = Markup.keyboard([
  ['🐶 Мой питомец', '⚔️ Бой'],
  ['🌱 Сад', '🎒 Инвентарь'],
  ['🏪 Магазин']
]).resize();

bot.hears('🐶 Мой питомец', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    getPet(user.id, (pet) => {
      if (!pet) return;
      
      updatePetStats(pet.id);
      
      // Получаем обновленного питомца
      db.get('SELECT * FROM pets WHERE id = ?', [pet.id], (err, updatedPet) => {
        if (err || !updatedPet) return;
        
        ctx.reply(
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
    });
  });
});

bot.hears('⚔️ Бой', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    getPet(user.id, (pet) => {
      if (!pet) return;
      
      ctx.reply(
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
  });
});

bot.hears('🌱 Сад', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    db.get('SELECT * FROM gardens WHERE user_id = ?', [user.id], (err, garden) => {
      if (err || !garden) {
        ctx.reply('❌ Ошибка загрузки сада');
        return;
      }
      
      let gardenText = '🌱 Ваш сад:\n\n';
      for (let i = 1; i <= 3; i++) {
        const slot = garden[`slot${i}`];
        gardenText += `${i}. ${slot ? `🌱 ${slot}` : '🌫️ Пусто'}\n`;
      }
      
      ctx.reply(
        gardenText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🌱 Посадить растение', 'plant_seed')],
          [Markup.button.callback('🌾 Собрать урожай', 'harvest_garden')]
        ])
      );
    });
  });
});

bot.hears('🎒 Инвентарь', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    db.all(`
      SELECT i.name, i.type, inv.quantity 
      FROM inventory inv 
      JOIN items i ON inv.item_id = i.id 
      WHERE inv.user_id = ?
    `, [user.id], (err, inventory) => {
      if (err) {
        ctx.reply('❌ Ошибка загрузки инвентаря');
        return;
      }
      
      if (inventory.length === 0) {
        ctx.reply('🎒 Ваш инвентарь пуст!', mainKeyboard);
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
      
      ctx.reply(inventoryText, mainKeyboard);
    });
  });
});

bot.hears('🏪 Магазин', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    db.all('SELECT * FROM items ORDER BY type, price', [], (err, items) => {
      if (err) {
        ctx.reply('❌ Ошибка загрузки магазина');
        return;
      }
      
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
      
      ctx.reply(
        shopText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🍎 Купить морковь (5 монет)', 'buy_carrot')],
          [Markup.button.callback('🌱 Купить семена (10 монет)', 'buy_seeds')],
          [Markup.button.callback('🔑 Купить ключ (100 монет)', 'buy_key')]
        ])
      );
    });
  });
});

// ==================== CALLBACK ОБРАБОТЧИКИ ====================
bot.action('feed_pet', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) {
      ctx.answerCbQuery('❌ Ошибка пользователя');
      return;
    }
    
    // Проверяем есть ли еда
    db.get(`
      SELECT inv.id, inv.quantity 
      FROM inventory inv 
      JOIN items i ON inv.item_id = i.id 
      WHERE inv.user_id = ? AND i.type = 'food'
      LIMIT 1
    `, [user.id], (err, food) => {
      if (err || !food) {
        ctx.answerCbQuery('У вас нет еды! Купите в магазине.');
        return;
      }
      
      // Используем еду
      if (food.quantity === 1) {
        db.run('DELETE FROM inventory WHERE id = ?', [food.id]);
      } else {
        db.run('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?', [food.id]);
      }
      
      // Кормим питомца
      getPet(user.id, (pet) => {
        if (!pet) return;
        
        const newHunger = Math.min(100, pet.hunger + 30);
        db.run('UPDATE pets SET hunger = ? WHERE id = ?', [newHunger, pet.id]);
        
        ctx.answerCbQuery('Питомец покормлен! +30 к голоду');
        ctx.editMessageText(
          `🍎 Вы покормили питомца!\n` +
          `🍖 Голод: ${newHunger.toFixed(1)}%\n` +
          `🍎 Еды осталось: ${food.quantity - 1}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('👈 Назад', 'back_to_main')]
          ])
        );
      });
    });
  });
});

bot.action('battle_easy', async (ctx) => {
  const telegramId = ctx.from.id;
  
  getOrCreateUser(telegramId, ctx.from.username, (user) => {
    if (!user) return;
    
    getPet(user.id, (pet) => {
      if (!pet) return;
      
      // Простой бой
      const playerDamage = Math.floor(Math.random() * 15) + 10;
      const aiDamage = Math.floor(Math.random() * 10) + 5;
      
      const playerHealth = Math.max(0, pet.health - aiDamage);
      const win = playerHealth > 0;
      
      if (win) {
        const reward = Math.floor(Math.random() * 11) + 10; // 10-20 монет
        db.run('UPDATE users SET coins = coins + ? WHERE id = ?', [reward, user.id]);
        db.run('UPDATE pets SET health = ?, exp = exp + 5 WHERE id = ?', [playerHealth, pet.id]);
        
        // Шанс получить предмет
        if (Math.random() < 0.3) {
          db.get('SELECT id FROM items WHERE rarity = ? ORDER BY RANDOM() LIMIT 1', ['common'], (err, item) => {
            if (!err && item) {
              db.run(`
                INSERT INTO inventory (user_id, item_id, quantity) 
                VALUES (?, ?, 1)
                ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
              `, [user.id, item.id]);
            }
          });
        }
        
        ctx.editMessageText(
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
        db.run('UPDATE pets SET health = 50 WHERE id = ?', [pet.id]);
        
        ctx.editMessageText(
          `💀 ПОРАЖЕНИЕ\n\n` +
          `Противник оказался сильнее!\n` +
          `Ваш питомец теряет сознание...\n\n` +
          `Не сдавайтесь! Попробуйте снова.`,
          mainKeyboard
        );
      }
      
      ctx.answerCbQuery();
    });
  });
});

bot.action('back_to_main', async (ctx) => {
  await ctx.editMessageText('Главное меню:', mainKeyboard);
  await ctx.answerCbQuery();
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

console.log('🚀 Бот запускается...');
