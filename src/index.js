require('dotenv').config();
const { Bot } = require('grammy');
const axios = require('axios');
const { Subscription } = require('./mongodb');
const keep_alive = require('./keep_alive');

const bot = new Bot(process.env.BOT_TOKEN);

bot.command('start', ctx => {
  const userName = ctx.from.first_name;

  const welcomMessage = `Привет 👋🏻, ${userName}!
  
  Добро пожаловать в LariumBot. Я помогу тебе отслеживать выход новых серий твоих любимых аниме. ☕️
  
  Чтобы подписаться на обновления аниме, используй команду /subscribe, вот так:
  
  /subscribe Название аниме
  
  Пример:
  /subscribe Этот глупый свин не понимает мечту девочки зайки
  
  Только будь уверен, что ты пишешь название тайтла который в онгоинге.

  Чтобы отписаться от обновлений аниме, используй команду /unsubscribe, вот так:

  /unsubscribe Название аниме

  Пример:
  /unsubscribe Этот глупый свин не понимает мечту девочки зайки

  Чтобы посмотреть список отслеживаемых аниме, используй команду /list.

  Чтобы получить информацию об аниме, используй команду /info, вот так:

  /info Название аниме

  Пример:
  /info Этот глупый свин не понимает мечту девочки зайки
  
  Попробуй прямо сейчас! ⛩`;

  ctx.reply(welcomMessage);
});

// Func for check if anime exists
async function checkAnimeExists(animeName) {
  try {
    const response = await axios.get(`https://shikimori.one/api/animes`, {
      params: {
        search: animeName,
        limit: 1,
      },

      headers: {
        'User-Agent': 'Larium/1.1',
      },
    });

    if (response.data.length > 0) {
      const animeId = response.data[0].id;
      const animeDetails = await axios.get(
        `https://shikimori.one/api/animes/${animeId}`,
        {
          headers: {
            'User-Agent': 'Larium/1.1',
          },
        }
      );

      return animeDetails.data;
    }

    return null;
  } catch (error) {
    console.error('Error checking anime', error);

    return null;
  }
}

bot.command('info', async ctx => {
  const animeName = ctx.message.text.split(' ').slice(1).join(' ');

  try {
    const anime = await checkAnimeExists(animeName);

    if (!anime) {
      return ctx.reply('Аниме не найдено. Проверьте правильность названия.');
    }

    const genres = anime.genres
      .map(genre => genre.russian || genre.name)
      .join(', ');

    const infoMessage = `Информация об аниме "${anime.russian || anime.name}":
    
    Количество серий: ${anime.episodes || 'Неизвестно'}
    Жанры: ${genres || 'Не указаны'}
    Описание: ${anime.description || 'Описание отсутствует'}Рейтинг: ${
      anime.score || 'Нет рейтинга'
    }`;

    ctx.reply(infoMessage);
  } catch (error) {
    console.error('Error fetching anime info', error);
    ctx.reply(
      'Произошли технические шоколадки при получении информации об аниме. Пожалуйста, попробуйте позже.'
    );
  }
});

bot.command('subscribe', async ctx => {
  const animeName = ctx.message.text.split(' ').slice(1).join(' ');
  const userId = ctx.from.id;

  const anime = await checkAnimeExists(animeName);

  if (!anime) {
    return ctx.reply('Аниме не найдено. Проверьте правильность названия.');
  }

  // Check if the user is already subscribed
  const existingSubscription = await Subscription.findOne({
    userId,
    animeId: anime.id,
  });

  if (existingSubscription) {
    return ctx.reply(
      `Вы уже отслеживаете выход новых серий аниме "${
        anime.russian || anime.name
      }".`
    );
  }

  const subscription = new Subscription({
    userId,
    animeId: anime.id,
    animeName: anime.russian || anime.name,
    lastEpisode: anime.episodes_aired || 0,
  });

  await subscription.save();
  ctx.reply(`Вы подписались на обновления аниме "${subscription.animeName}"`);
});

bot.command('unsubscribe', async ctx => {
  const animeName = ctx.message.text.split(' ').slice(1).join(' ');
  const userId = ctx.from.id;

  try {
    const result = await Subscription.findOneAndDelete({ userId, animeName });

    if (result) {
      ctx.reply(`Вы успешно отписались от обновлений аниме "${animeName}".`);
    } else {
      ctx.reply(
        `Вы не были подписаны на аниме "${animeName}" или оно не было найдено.`
      );
    }
  } catch (error) {
    console.error('Error unsubscribing from anime', error);
    ctx.reply('Произошли технические шоколадки. Пожалуйста, попробуйте позже.');
  }
});

bot.command('list', async ctx => {
  const userId = ctx.from.id;

  try {
    const subscriptions = await Subscription.find({ userId });

    if (subscriptions.length === 0) {
      return ctx.reply('Вы пока не отслеживаете ни одного аниме.');
    }

    const animeList = subscriptions
      .map((sub, index) => `${index + 1}. ${sub.animeName}`)
      .join('\n');

    const message = `Вот список отслеживаемых вами аниме:\n\n${animeList}`;
    ctx.reply(message);
  } catch (error) {
    console.error('Error fetching subscriptions', error);
    ctx.reply(
      'Произошли технические шоколадки при получении списка. Пожалуйста, попробуйте позже.'
    );
  }
});

async function checkNewEpisodes() {
  const subscription = await Subscription.find();

  for (const sub of subscription) {
    try {
      const response = await axios.get(
        `https://shikimori.one/api/animes/${sub.animeId}`,
        {
          headers: {
            'User-Agent': 'Larium/1.1',
          },
        }
      );

      const anime = response.data;

      if (anime.status === 'released') {
        await Subscription.deleteOne({ _id: sub._id });
        bot.api.sendMessage(
          sub.userId,
          `Аниме "${sub.animeName}" завершилось и была удалено из вашего списка отслеживания.`
        );

        continue;
      }

      if (anime.episodes_aired > sub.lastEpisode) {
        const newEpisodes = anime.episodes_aired - sub.lastEpisode;
        bot.api.sendMessage(
          sub.userId,
          `Вышла ${newEpisodes} серия по аниме "${sub.animeName}"!`
        );
        sub.lastEpisode = anime.episodes_aired;
        await sub.save();
      }
    } catch (error) {
      console.error('Error checking new episodes', error);
    }
  }
}

// Schedule the func checkNewEpisodes for in 60 minutes
setInterval(checkNewEpisodes, 3600000);

bot.start();
