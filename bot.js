import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { detectAll } from 'tinyld';
import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import pLimit from 'p-limit';
import dotenv from 'dotenv';

// Імпорт Instagram API модуля
import * as InstagramAPI from './instagramApiCore.js';

dotenv.config();

// ==========================================
// ⚙️ КОНФІГУРАЦІЯ ТА НАЛАШТУВАННЯ
// ==========================================

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

// ІДЕНТИФІКАТОРИ АДМІНІСТРАТОРІВ
const ADMINISTRATOR_IDS = [8382862311, 8469943654];

// ШЛЯХИ ДО ФАЙЛІВ ДАНИХ
const DATA_DIRECTORY = process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const USERS_DATA_FILE = path.join(DATA_DIRECTORY, 'users.json');
const REELS_DATABASE_FILE = path.join(DATA_DIRECTORY, 'reels_database.json');
const INSTAGRAM_ACCOUNTS_FILE = path.join(DATA_DIRECTORY, 'instagram_accounts.json');
const SYSTEM_SETTINGS_FILE = path.join(DATA_DIRECTORY, 'system_settings.json');

// СТАНДАРТНІ НАЛАШТУВАННЯ ПАРСИНГУ
const DEFAULT_USER_LIMIT = 1000;
const DEFAULT_MAXIMUM_FOLLOWERS = 1000000000;

// ==========================================
// 🍪 МЕНЕДЖЕР АКАУНТІВ INSTAGRAM
// ==========================================

let instagramAccounts = [];
let systemSettings = {
    concurrencyLimit: 2,
    hashtagConcurrencyLimit: 1,
    requestLimitBeforeRotation: 15,
    delaySettings: {
        minimumDelay: 1000,
        maximumDelay: 2500,
        hashtagMinimumDelay: 2000,
        hashtagMaximumDelay: 4000,
        betweenBatchesDelay: 3000
    }
};

let currentAccountIndex = 0;
let requestCounter = 0;

// ==========================================
// 🛡️ ІНІЦІАЛІЗАЦІЯ СИСТЕМИ
// ==========================================

process.on('uncaughtException', (exceptionError) => {
    console.error('🔥 КРИТИЧНА ПОМИЛКА СИСТЕМИ (Uncaught Exception):', exceptionError.message, exceptionError.stack);
});

process.on('unhandledRejection', (rejectionReason, promise) => {
    console.error('🔥 КРИТИЧНА ПОМИЛКА СИСТЕМИ (Unhandled Rejection):', rejectionReason);
});

if (!telegramBotToken) {
    console.error('❌ КРИТИЧНА ПОМИЛКА: Не встановлено змінну середовища TELEGRAM_BOT_TOKEN!');
    process.exit(1);
}

const telegramBot = new TelegramBot(telegramBotToken, { polling: true });
const concurrentLimit = pLimit(systemSettings.concurrencyLimit);
const hashtagConcurrentLimit = pLimit(systemSettings.hashtagConcurrencyLimit);

const userStatesMap = new Map();
let authorizedUsersList = [];
let reelsTrackingDatabase = {};

const EMAIL_REGULAR_EXPRESSION = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// ==========================================
// 🔐 СИСТЕМА ДОСТУПУ ТА АВТОРИЗАЦІЇ
// ==========================================

const loadAuthorizedUsers = async () => {
    try {
        const usersData = await fs.readFile(USERS_DATA_FILE, 'utf-8');
        authorizedUsersList = JSON.parse(usersData);
        console.log(`✅ Завантажено ${authorizedUsersList.length} авторизованих користувачів`);
    } catch (loadError) { 
        authorizedUsersList = []; 
        await saveAuthorizedUsers(); 
    }

    try {
        const reelsDatabaseData = await fs.readFile(REELS_DATABASE_FILE, 'utf-8');
        reelsTrackingDatabase = JSON.parse(reelsDatabaseData);
        console.log(`✅ Завантажено базу даних Reels`);
    } catch (reelsError) { 
        reelsTrackingDatabase = {}; 
        await saveReelsTrackingDatabase(); 
    }
};

const saveAuthorizedUsers = async () => {
    try { 
        await fs.writeFile(USERS_DATA_FILE, JSON.stringify(authorizedUsersList, null, 2)); 
    } catch (saveError) {
        console.error('❌ Помилка збереження списку авторизованих користувачів:', saveError);
    }
};

const saveReelsTrackingDatabase = async () => {
    try { 
        await fs.writeFile(REELS_DATABASE_FILE, JSON.stringify(reelsTrackingDatabase, null, 2)); 
    } catch (saveError) {
        console.error('❌ Помилка збереження бази даних відстеження Reels:', saveError);
    }
};

const userHasAccess = (userId) => {
    return ADMINISTRATOR_IDS.includes(userId) || authorizedUsersList.some(user => user.id === userId);
};

const userIsAdministrator = (userId) => ADMINISTRATOR_IDS.includes(userId);

// ==========================================
// 📋 НАЛАШТУВАННЯ МЕНЮ БОТА
// ==========================================

const setupBotCommandMenu = async () => {
    try {
        await telegramBot.setMyCommands([
            { command: 'start', description: '🚀 Почати роботу з ботом' },
            { command: 'settings', description: '⚙️ Налаштування системи' },
            { command: 'accounts', description: '👤 Керування акаунтами Instagram' },
            { command: 'stats', description: '📊 Статистика роботи системи' },
            { command: 'help', description: '📚 Довідка та інструкції' }
        ]);
        console.log('✅ Меню команд бота успішно встановлено');
    } catch (menuError) {
        console.error('❌ Помилка встановлення меню команд бота:', menuError.message);
    }
};

// ==========================================
// 🛠️ ДОПОМІЖНІ ФУНКЦІЇ ТА УТИЛІТИ
// ==========================================

const formatLargeNumber = (number) => {
    return InstagramAPI.formatNumber(number);
};

const extractEmailFromText = (textContent) => {
    return InstagramAPI.extractEmail(textContent);
};

const escapeHtmlSpecialCharacters = (inputString) => {
    if (inputString == null) return '';
    return String(inputString)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const generateProgressBar = (currentProgress, totalProgress, barLength = 10) => {
    const progressPercentage = totalProgress > 0 ? Math.min(100, Math.round((currentProgress / totalProgress) * 100)) : 0;
    const filledBarLength = Math.round((progressPercentage / 100) * barLength);
    const emptyBarLength = barLength - filledBarLength;
    const filledBar = '█'.repeat(filledBarLength);
    const emptyBar = '░'.repeat(emptyBarLength);
    return `[${filledBar}${emptyBar}] ${progressPercentage}%`;
};

const pauseExecution = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
const randomPauseExecution = (minimumMilliseconds, maximumMilliseconds) => pauseExecution(Math.floor(Math.random() * (maximumMilliseconds - minimumMilliseconds + 1) + minimumMilliseconds));

const formatTimeDuration = (milliseconds) => {
    if (milliseconds < 1000) return `${milliseconds} мс`;
    if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)} с`;
    return `${Math.floor(milliseconds / 60000)} хв ${Math.floor((milliseconds % 60000) / 1000)} с`;
};

// ==========================================
// 📡 API INSTAGRAM (ІНТЕГРОВАНА ВЕРСІЯ)
// ==========================================

const getInstagramUserById = InstagramAPI.getUserById;
const getUserIdFromUsername = InstagramAPI.getUserIdFromUsername;

const getAllFollowersForUser = async (userId, limitCount, progressCallback = null) => {
    return await InstagramAPI.getAllFollowers(userId, limitCount, progressCallback);
};

const getAllFollowingForUser = async (userId, limitCount, progressCallback = null) => {
    return await InstagramAPI.getAllFollowing(userId, limitCount, progressCallback);
};

const getUsersByHashtag = async (hashtag, limitCount, progressCallback = null) => {
    return await InstagramAPI.getUsersByHashtag(hashtag, limitCount, progressCallback);
};

const getUserReelsStatistics = async (userId) => {
    return await InstagramAPI.getReels(userId, { pageSize: 20 });
};

const getUserPostsContent = async (username) => {
    return await InstagramAPI.getPosts(username, { count: 12 });
};

// ==========================================
// 📊 ОБРОБКА ТА АНАЛІЗ ДАНИХ
// ==========================================

const processInstagramUser = async (userId, userIndex, totalUsers, progressCallback) => {
    try {
        // Додаємо випадкову затримку між запитами
        await randomPauseExecution(systemSettings.delaySettings.minimumDelay, systemSettings.delaySettings.maximumDelay);
        
        const userData = await getInstagramUserById(userId);
        if (!userData) {
            progressCallback(userIndex + 1, totalUsers, null, 'skipped');
            return null;
        }

        const followersCount = userData.follower_count || 0;
        const isPrivateProfile = userData.is_private || false;

        if (isPrivateProfile) {
            progressCallback(userIndex + 1, totalUsers, userData.username, 'private');
            return null;
        }

        const username = userData.username || 'Не вказано';
        const fullName = userData.full_name || 'Не вказано';
        const biographyText = userData.biography || '';

        const reelsViewsData = await getUserReelsStatistics(userId);
        const averageReelsViews = reelsViewsData.length > 0 
            ? Math.round(reelsViewsData.reduce((sum, views) => sum + views, 0) / reelsViewsData.length) 
            : 0;

        const postsContent = await getUserPostsContent(username);
        const extractedEmail = extractEmailFromText(postsContent) || extractEmailFromText(biographyText);

        const processedUser = {
            username,
            fullName,
            followers: followersCount,
            avgReelsViews: averageReelsViews,
            rawAverageViews: averageReelsViews,
            email: extractedEmail,
            language: detectAll(biographyText || postsContent)[0]?.lang || 'uk',
            profile_pic_url: userData.profile_pic_url || null,
            isPrivateProfile,
            rawFollowerCount: followersCount
        };

        progressCallback(userIndex + 1, totalUsers, username, 'processed');
        return processedUser;
        
    } catch (processingError) {
        console.error(`❌ Помилка обробки користувача ${userId}:`, processingError.message);
        progressCallback(userIndex + 1, totalUsers, null, 'error');
        return null;
    }
};

const mapAndProcessUsers = async (userIds, parsingConfiguration, progressCallback) => {
    const processingResults = [];
    const totalUsersToProcess = Math.min(userIds.length, parsingConfiguration.limit);
    
    console.log(`🔄 Початок обробки ${totalUsersToProcess} користувачів...`);

    // Обробляємо користувачів пачками для оптимізації
    const batchProcessingSize = systemSettings.concurrencyLimit * 3;
    
    for (let batchStartIndex = 0; batchStartIndex < totalUsersToProcess; batchStartIndex += batchProcessingSize) {
        const batchEndIndex = Math.min(batchStartIndex + batchProcessingSize, totalUsersToProcess);
        const currentBatch = userIds.slice(batchStartIndex, batchEndIndex);
        
        const batchProcessingPromises = currentBatch.map((userId, indexInBatch) => 
            concurrentLimit(() => processInstagramUser(userId, batchStartIndex + indexInBatch, totalUsersToProcess, progressCallback))
        );
        
        const batchResults = await Promise.all(batchProcessingPromises);
        processingResults.push(...batchResults.filter(result => result !== null));
        
        // Додаємо паузу між пачками для уникнення блокування
        if (batchEndIndex < totalUsersToProcess) {
            await pauseExecution(systemSettings.delaySettings.betweenBatchesDelay);
        }
    }
    
    // Фільтруємо користувачів за мінімальною кількістю підписників
    return processingResults
        .filter(user => user.followers >= parsingConfiguration.min && user.followers <= parsingConfiguration.max)
        .sort((firstUser, secondUser) => secondUser.rawAverageViews - firstUser.rawAverageViews);
};

// ==========================================
// 📁 ЗБЕРЕЖЕННЯ ДАНИХ У ФАЙЛ EXCEL
// ==========================================

const saveResultsToExcelFile = async (processedData, sourceIdentifier) => {
    try {
        const excelWorkbook = new ExcelJS.Workbook();
        const excelWorksheet = excelWorkbook.addWorksheet('Результати парсингу');

        excelWorksheet.columns = [
            { header: 'Аватар профілю', key: 'profile_avatar', width: 15 },
            { header: 'Ім\'я користувача', key: 'username', width: 20 },
            { header: 'Посилання на профіль', key: 'profile_url', width: 40 },
            { header: 'Повне ім\'я', key: 'full_name', width: 25 },
            { header: 'Кількість підписників', key: 'followers_count', width: 15 },
            { header: 'Електронна пошта', key: 'email_address', width: 30 },
            { header: 'Середні перегляди Reels', key: 'average_views', width: 20 },
            { header: 'Мова профілю', key: 'profile_language', width: 15 }
        ];

        // Застосовуємо стилі для заголовків таблиці
        excelWorksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        excelWorksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };
        excelWorksheet.getRow(1).height = 25;

        for (let dataIndex = 0; dataIndex < processedData.length; dataIndex++) {
            const currentUser = processedData[dataIndex];
            const dataRow = excelWorksheet.addRow({
                username: currentUser.username || '',
                profile_url: `https://www.instagram.com/${currentUser.username}/`,
                full_name: currentUser.fullName || '',
                followers_count: currentUser.followers || 0,
                email_address: currentUser.email || '',
                average_views: formatLargeNumber(currentUser.avgReelsViews) || '0',
                profile_language: currentUser.language || ''
            });

            dataRow.height = 80;

            // Додаємо аватар профілю, якщо він доступний
            if (currentUser.profile_pic_url) {
                try {
                    const imageResponse = await axios.get(currentUser.profile_pic_url, {
                        responseType: 'arraybuffer',
                        timeout: 10000
                    });
                    
                    const imageFormat = currentUser.profile_pic_url.includes('.png') ? 'png' : 
                                      currentUser.profile_pic_url.includes('.gif') ? 'gif' : 
                                      currentUser.profile_pic_url.includes('.webp') ? 'webp' : 'jpeg';

                    const imageIdentifier = excelWorkbook.addImage({
                        buffer: imageResponse.data,
                        extension: imageFormat
                    });

                    excelWorksheet.addImage(imageIdentifier, {
                        tl: { col: 0, row: dataIndex + 1 },
                        br: { col: 1, row: dataIndex + 2 },
                        editAs: 'oneCell'
                    });
                } catch (imageError) {
                    console.log(`⚠️ Не вдалося завантажити аватар профілю для користувача ${currentUser.username}`);
                }
            }
        }

        // Автоматично налаштовуємо ширину стовпців
        excelWorksheet.columns.forEach(column => {
            let maximumColumnLength = 0;
            column.eachCell({ includeEmpty: true }, cell => {
                const currentCellLength = cell.value ? cell.value.toString().length : 10;
                if (currentCellLength > maximumColumnLength) {
                    maximumColumnLength = currentCellLength;
                }
            });
            column.width = Math.min(maximumColumnLength + 2, 50);
        });

        const safeFileName = `${sourceIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.xlsx`;
        const filePath = path.join(DATA_DIRECTORY, safeFileName);
        
        await excelWorkbook.xlsx.writeFile(filePath);
        console.log(`✅ Успішно збережено ${processedData.length} результатів у файл ${filePath}`);
        
        return filePath;
        
    } catch (excelError) {
        console.error('❌ Критична помилка при збереженні даних у Excel:', excelError);
        throw excelError;
    }
};

// ==========================================
// 🚀 ОСНОВНИЙ ПРОЦЕС ПАРСИНГУ ДАНИХ
// ==========================================

async function executeScrapingProcess(chatId, parsingConfiguration) {
    const processStartTime = Date.now();
    let statusMessageObject = null;
    
    try {
        // Формуємо інформаційне повідомлення про початок парсингу
        const initialStatusMessage = `
<b>🎯 SAMIParser розпочав роботу!</b>

📁 <b>Джерело даних:</b> ${escapeHtmlSpecialCharacters(parsingConfiguration.source)}
📊 <b>Тип парсингу:</b> ${parsingConfiguration.type === 'hashtag' ? 'Пошук за хештегом' : 
                          parsingConfiguration.type === 'followers' ? 'Аналіз підписників' : 'Аналіз підписок'}
🎯 <b>Цільова кількість:</b> ${parsingConfiguration.limit} користувачів
📈 <b>Мінімум підписників:</b> ${parsingConfiguration.min}
📉 <b>Максимум підписників:</b> ${parsingConfiguration.max}

⏳ <i>Виконується підготовка до початку парсингу...</i>
        `.trim();
        
        statusMessageObject = await telegramBot.sendMessage(chatId, initialStatusMessage, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true 
        });

        // Етап 1: Отримання ідентифікаторів користувачів
        await telegramBot.editMessageText(
            `${initialStatusMessage}\n\n🔄 <b>Етап 1 з 2:</b> Отримання ідентифікаторів користувачів...`,
            { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
        );

        let allUserIds = [];
        let lastProgressUpdateTime = Date.now();
        
        const fetchProgressHandler = async (currentCount) => {
            const currentTime = Date.now();
            if (currentTime - lastProgressUpdateTime > 3000) {
                await telegramBot.editMessageText(
                    `${initialStatusMessage}\n\n🔄 <b>Етап 1 з 2:</b> Отримання ідентифікаторів користувачів\n` +
                    `📥 Знайдено ідентифікаторів: <b>${currentCount}</b>\n` +
                    `${generateProgressBar(currentCount, parsingConfiguration.limit)}`,
                    { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
                );
                lastProgressUpdateTime = currentTime;
            }
        };

        try {
            if (parsingConfiguration.type === 'hashtag') {
                allUserIds = await getUsersByHashtag(parsingConfiguration.source, parsingConfiguration.limit, fetchProgressHandler);
            } else {
                const targetUserId = await getUserIdFromUsername(parsingConfiguration.source);
                if (parsingConfiguration.type === 'followers') {
                    allUserIds = await getAllFollowersForUser(targetUserId, parsingConfiguration.limit, fetchProgressHandler);
                } else {
                    allUserIds = await getAllFollowingForUser(targetUserId, parsingConfiguration.limit, fetchProgressHandler);
                }
            }
        } catch (dataFetchingError) {
            await telegramBot.editMessageText(
                `❌ <b>Помилка отримання даних з Instagram:</b>\n` +
                `<code>${escapeHtmlSpecialCharacters(dataFetchingError.message)}</code>\n\n` +
                `Будь ласка, перевірте правильність введених даних та спробуйте ще раз.`,
                { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
            );
            return;
        }

        if (allUserIds.length === 0) {
            await telegramBot.editMessageText(
                `❌ <b>Не знайдено жодного користувача за вказаними критеріями!</b>\n\n` +
                `Рекомендуємо перевірити:\n` +
                `• Правильність введеного імені користувача або хештегу\n` +
                `• Доступність профілю або хештегу для публічного перегляду\n` +
                `• Можливі тимчасові обмеження з боку Instagram`,
                { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
            );
            return;
        }

        // Етап 2: Детальний аналіз знайдених користувачів
        await telegramBot.editMessageText(
            `${initialStatusMessage}\n\n✅ <b>Етап 1 з 2 успішно завершено!</b>\n` +
            `Знайдено: <b>${allUserIds.length}</b> користувачів\n\n` +
            `🔄 <b>Етап 2 з 2:</b> Детальний аналіз користувачів...\n` +
            `${generateProgressBar(0, Math.min(allUserIds.length, parsingConfiguration.limit))}`,
            { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
        );

        let processedUsersCount = 0;
        let suitableUsersCount = 0;
        let lastProgressNotificationTime = Date.now();
        let currentProcessingUsername = 'Початок аналізу...';
        
        const processingProgressHandler = async (currentIndex, totalCount, username, processingStatus) => {
            processedUsersCount = currentIndex;
            
            if (processingStatus === 'processed') suitableUsersCount++;
            if (username) currentProcessingUsername = username;
            
            const currentNotificationTime = Date.now();
            if (currentNotificationTime - lastProgressNotificationTime > 2500) {
                const elapsedProcessingTime = Date.now() - processStartTime;
                const estimatedRemainingTime = totalCount > 0 ? (elapsedProcessingTime / currentIndex) * (totalCount - currentIndex) : 0;
                
                await telegramBot.editMessageText(
                    `${initialStatusMessage}\n\n✅ <b>Етап 1 з 2 успішно завершено!</b>\n` +
                    `Знайдено: <b>${allUserIds.length}</b> користувачів\n\n` +
                    `🔄 <b>Етап 2 з 2:</b> Детальний аналіз користувачів\n` +
                    `👤 <b>Поточний користувач:</b> ${escapeHtmlSpecialCharacters(currentProcessingUsername)}\n` +
                    `📊 <b>Статус обробки:</b> ${processingStatus === 'processed' ? '✅ Знайдено підходящий профіль' : 
                                                processingStatus === 'private' ? '🔒 Приватний профіль' : 
                                                processingStatus === 'skipped' ? '⏭ Профіль пропущено' : 
                                                processingStatus === 'min_followers' ? '📉 Замало підписників' :
                                                processingStatus === 'max_followers' ? '📈 Забагато підписників' :
                                                '❌ Помилка обробки'}\n\n` +
                    `${generateProgressBar(currentIndex, totalCount)}\n` +
                    `🔢 <b>Оброблено користувачів:</b> ${currentIndex}/${totalCount}\n` +
                    `✅ <b>Знайдено підходящих:</b> ${suitableUsersCount}\n` +
                    `⏱ <b>Витрачено часу:</b> ${formatTimeDuration(elapsedProcessingTime)} / ~${formatTimeDuration(estimatedRemainingTime)}`,
                    { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
                );
                lastProgressNotificationTime = currentNotificationTime;
            }
        };

        const finalResults = await mapAndProcessUsers(allUserIds, parsingConfiguration, processingProgressHandler);

        // Етап 3: Формування звіту та збереження результатів
        await telegramBot.editMessageText(
            `${initialStatusMessage}\n\n✅ <b>Обидва етапи успішно завершено!</b>\n\n` +
            `📊 <b>Підсумкові результати:</b>\n` +
            `• Перевірено профілів: ${processedUsersCount} користувачів\n` +
            `• Знайдено відповідних профілів: ${suitableUsersCount}\n` +
            `• Відфільтровано за критеріями: ${finalResults.length} (за мінімумом ${parsingConfiguration.min} підписників)\n\n` +
            `💾 <b>Етап 3 з 3:</b> Формування детального звіту...`,
            { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
        );

        if (finalResults.length === 0) {
            await telegramBot.editMessageText(
                `❌ <b>Не знайдено профілів, які відповідають критеріям пошуку!</b>\n\n` +
                `Встановлені критерії пошуку:\n` +
                `• Мінімальна кількість підписників: ${parsingConfiguration.min}\n` +
                `• Максимальна кількість підписників: ${parsingConfiguration.max}\n` +
                `• Тільки публічні профілі\n\n` +
                `Рекомендуємо змінити критерії пошуку та спробувати ще раз.`,
                { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
            );
            return;
        }

        const excelFilePath = await saveResultsToExcelFile(finalResults, parsingConfiguration.source);
        const excelFileBuffer = await fs.readFile(excelFilePath);
        const totalProcessingTime = Date.now() - processStartTime;

        await telegramBot.sendDocument(chatId, excelFileBuffer, {}, {
            filename: `SAMIParser_${parsingConfiguration.source}_${Date.now()}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            caption: `
✅ <b>Парсинг даних успішно завершено!</b>

📊 <b>Детальні результати:</b>
• Джерело даних: ${escapeHtmlSpecialCharacters(parsingConfiguration.source)}
• Тип парсингу: ${parsingConfiguration.type === 'hashtag' ? 'Пошук за хештегом' : parsingConfiguration.type === 'followers' ? 'Аналіз підписників' : 'Аналіз підписок'}
• Знайдено профілів: ${finalResults.length} користувачів
• Мінімум підписників: ${parsingConfiguration.min}
• Максимум підписників: ${parsingConfiguration.max}
• Загальний час виконання: ${formatTimeDuration(totalProcessingTime)}

📁 <b>Звіт містить такі дані:</b>
• Ім'я користувача та посилання на профіль
• Повне ім'я користувача
• Кількість підписників
• Електронну пошту (якщо знайдено в профілі)
• Середню кількість переглядів Reels
• Мову профілю користувача
            `.trim(),
            parse_mode: 'HTML'
        });

        // Видаляємо тимчасовий файл Excel
        await fs.unlink(excelFilePath).catch(() => {});

        // Оновлюємо статусне повідомлення
        await telegramBot.deleteMessage(chatId, statusMessageObject.message_id).catch(() => {});
        
        await telegramBot.sendMessage(chatId, 
            `✨ <b>Операція успішно виконана!</b> Файл з результатами надіслано вище.\n\n` +
            `🔄 <i>Система готова до виконання нового запиту. Оберіть наступну опцію з головного меню.</i>`,
            { parse_mode: 'HTML' }
        );

    } catch (criticalError) {
        console.error('❌ Критична помилка в процесі парсингу:', criticalError);
        
        if (statusMessageObject) {
            await telegramBot.editMessageText(
                `❌ <b>Виникла критична помилка!</b>\n\n` +
                `<code>${escapeHtmlSpecialCharacters(criticalError.message)}</code>\n\n` +
                `⏳ <i>Рекомендуємо спробувати ще раз через декілька хвилин.</i>`,
                { chat_id: chatId, message_id: statusMessageObject.message_id, parse_mode: 'HTML' }
            );
        } else {
            await telegramBot.sendMessage(chatId,
                `❌ <b>Виникла критична помилка!</b>\n\n` +
                `<code>${escapeHtmlSpecialCharacters(criticalError.message)}</code>`,
                { parse_mode: 'HTML' }
            );
        }
    }
}

// ==========================================
// 📊 СТАТИСТИКА ТА МОНІТОРИНГ РОБОТИ СИСТЕМИ
// ==========================================

const getSystemStatistics = () => {
    const activeInstagramAccounts = instagramAccounts.filter(account => account.status === 'active');
    const totalRequestsCount = instagramAccounts.reduce((sum, account) => sum + (account.totalRequestsCount || 0), 0);
    
    return {
        activeAccountsCount: activeInstagramAccounts.length,
        totalAccountsCount: instagramAccounts.length,
        totalRequestsCount: totalRequestsCount,
        authorizedUsersCount: authorizedUsersList.length,
        reelsVideosTracked: Object.values(reelsTrackingDatabase).flat().length,
        systemUptime: process.uptime()
    };
};

const displaySystemStatistics = async (chatId) => {
    const currentStatistics = getSystemStatistics();
    
    const statisticsMessage = `
📊 <b>Детальна статистика роботи системи</b>

👥 <b>Користувачі системи:</b>
• Авторизованих користувачів: ${currentStatistics.authorizedUsersCount}
• Адміністраторів системи: ${ADMINISTRATOR_IDS.length}

👤 <b>Акаунти Instagram:</b>
• Активних акаунтів: ${currentStatistics.activeAccountsCount}/${currentStatistics.totalAccountsCount}
• Виконано запитів всього: ${currentStatistics.totalRequestsCount}

📹 <b>Відстеження Reels:</b>
• Відстежується відео: ${currentStatistics.reelsVideosTracked}

⚙️ <b>Загальна інформація про систему:</b>
• Час роботи системи: ${Math.floor(currentStatistics.systemUptime / 3600)} годин ${Math.floor((currentStatistics.systemUptime % 3600) / 60)} хвилин
• Використана пам'ять: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} МБ

🔄 <b>Поточний акаунт Instagram:</b>
• Ім'я користувача: ${'instagram_api_user' || 'Не визначено'}
• Виконано запитів: ${currentStatistics.totalRequestsCount || 0}
    `.trim();
    
    await telegramBot.sendMessage(chatId, statisticsMessage, { parse_mode: 'HTML' });
};

// ==========================================
// ⚙️ СИСТЕМА КЕРУВАННЯ АКАУНТАМИ INSTAGRAM
// ==========================================

const displayAccountsManagementMenu = async (chatId) => {
    if (!userIsAdministrator(chatId)) {
        return telegramBot.sendMessage(chatId, '❌ Ви не маєте дозволу на доступ до цієї функції');
    }
    
    const menuButtons = [
        [{ text: '📋 Перегляд списку акаунтів', callback_data: 'account_list_display' }],
        [{ text: '➕ Додати новий акаунт', callback_data: 'account_add_new' }],
        [{ text: '⚙️ Налаштування затримок запитів', callback_data: 'account_delay_settings' }],
        [{ text: '📊 Статистика використання акаунтів', callback_data: 'account_usage_statistics' }],
        [{ text: '🔄 Перевірка активності акаунтів', callback_data: 'account_activity_check' }]
    ];
    
    await telegramBot.sendMessage(chatId, 
        '👤 <b>Керування акаунтами Instagram</b>\n\n' +
        'Оберіть потрібну дію з меню нижче:',
        { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: menuButtons }
        }
    );
};

const addNewInstagramAccount = async (chatId) => {
    userStatesMap.set(chatId, {
        step: 'adding_new_account',
        type: 'account_management',
        data: {}
    });
    
    const instructionsMessage = `
<b>➕ Процес додавання нового акаунта Instagram</b>

Для успішного додавання акаунта необхідно виконати наступні кроки:
1. Увійдіть в свій обліковий запис Instagram через веб-браузер
2. Відкрийте інструменти розробника (натисніть F12)
3. Перейдіть на вкладку "Network" (Мережа)
4. Знайдіть будь-який запит до домену instagram.com
5. Знайдіть заголовок "Cookie" в розділі "Request Headers"
6. Скопіюйте весь текст цього заголовка
7. Відправте скопійований текст сюди

⚠️ <i>Важливе застереження: Використовуйте виключно свої особисті акаунти Instagram!</i>
    `.trim();
    
    await telegramBot.sendMessage(chatId, instructionsMessage, { 
        parse_mode: 'HTML',
        reply_markup: {
            keyboard: [[{ text: '↩️ Скасувати додавання акаунта' }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
};

const parseInstagramCookieString = (cookieString) => {
    const parsedCookies = {};
    cookieString.split(';').forEach(cookieItem => {
        const [cookieName, ...cookieValueParts] = cookieItem.trim().split('=');
        const cookieValue = cookieValueParts.join('=');
        if (cookieName && cookieValue) {
            parsedCookies[cookieName] = cookieValue;
        }
    });
    
    // Перевіряємо наявність обов'язкових кукісів
    const requiredCookies = ['csrftoken', 'sessionid', 'ds_user_id'];
    for (const requiredCookie of requiredCookies) {
        if (!parsedCookies[requiredCookie]) {
            throw new Error(`У наданому рядку кукісів відсутній обов'язковий параметр: ${requiredCookie}`);
        }
    }
    
    return {
        cookie: cookieString,
        csrftoken: parsedCookies.csrftoken,
        sessionid: parsedCookies.sessionid,
        ds_user_id: parsedCookies.ds_user_id,
        mid: parsedCookies.mid || '',
        ig_did: parsedCookies.ig_did || '',
        datr: parsedCookies.datr || '',
        lsd: parsedCookies.lsd || '-HXhKAXlTZFnZVudz5X0kJ',
        fb_dtsg: parsedCookies.fb_dtsg || 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021'
    };
};

// ==========================================
// 📹 СИСТЕМА ВІДСТЕЖЕННЯ REELS
// ==========================================

const getReelMetricsWithLikes = async (reelUrl) => {
    try {
        const reelMatch = reelUrl.match(/\/reel\/([^/?]+)/);
        if (!reelMatch) {
            console.log(`❌ Некоректне посилання на Reels: ${reelUrl}`);
            return null;
        }
        
        const shortcode = reelMatch[1];
        console.log(`🔍 Отримання метрик для Reels: ${shortcode}`);

        try {
            const variables = { shortcode: shortcode };
            
            const params = new URLSearchParams({
                av: '17841419081024045',
                __d: 'www',
                __user: '0',
                __a: '1',
                __req: '1',
                __hs: '20402.HCSV2:instagram_web_pkg.2.1...0',
                dpr: '2',
                __ccg: 'GOOD',
                __rev: '1029645341',
                fb_dtsg: 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021',
                lsd: 'vVbWdDNFnfguO3z1lxm1aQ',
                jazoest: '26265',
                doc_id: '10015901848480474',
                variables: JSON.stringify(variables)
            });

            const response = await axios.post(
                'https://www.instagram.com/api/graphql',
                params.toString(),
                {
                    headers: await InstagramAPI.igHeaders({
                        'x-fb-friendly-name': 'PolarisReelMediaQuery',
                        'referer': `https://www.instagram.com/reel/${shortcode}/`
                    }),
                    timeout: 30000
                }
            );

            const mediaData = response.data?.data?.xdt_shortcode_media;
            
            if (mediaData) {
                const result = {
                    views: mediaData.video_view_count || mediaData.video_play_count || 0,
                    likes: mediaData.edge_media_preview_like?.count || 0,
                    comments: mediaData.edge_media_to_parent_comment?.count || 0,
                    shortcode: shortcode
                };

                if (result.views > 0) {
                    console.log(`✅ Reels ${shortcode}: ${result.views} переглядів, ${result.likes} лайків, ${result.comments} коментарів`);
                    return result;
                }
            }

        } catch (graphqlError) {
            console.log(`⚠️ GraphQL метод не спрацював: ${graphqlError.message}`);
            
            // Спроба альтернативного методу
            try {
                const alternativeResponse = await axios.get(
                    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
                    {
                        headers: await InstagramAPI.igHeaders({
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            "X-IG-App-ID": "936619743392459"
                        }),
                        timeout: 30000
                    }
                );

                const mediaItems = alternativeResponse.data?.items?.[0];
                if (mediaItems) {
                    const result = {
                        views: mediaItems.view_count || mediaItems.play_count || 0,
                        likes: mediaItems.like_count || 0,
                        comments: mediaItems.comment_count || 0,
                        shortcode: shortcode
                    };

                    if (result.views > 0) {
                        console.log(`✅ Reels ${shortcode}: ${result.views} переглядів (альтернативний метод)`);
                        return result;
                    }
                }
            } catch (alternativeError) {
                console.log(`⚠️ Альтернативний метод не спрацював: ${alternativeError.message}`);
            }
        }

        console.log(`❌ Всі методи не спрацювали для: ${shortcode}`);
        return { views: 0, likes: 0, comments: 0, shortcode: shortcode };

    } catch (error) {
        console.error(`[Помилка Reels] ${reelUrl}: ${error.message}`);
        return { views: 0, likes: 0, comments: 0, shortcode: 'error' };
    }
};

const sendReelsTrackerReport = async (chatId) => {
    const userVideoLinks = reelsTrackingDatabase[chatId] || [];
    
    if (!userVideoLinks.length) {
        await telegramBot.sendMessage(chatId, '📭 Ваш список відстеження Reels порожній.');
        return;
    }

    const progressMessage = await telegramBot.sendMessage(chatId, `⏳ Збір даних для ${userVideoLinks.length} відео...`);

    const excelWorkbook = new ExcelJS.Workbook();
    const excelWorksheet = excelWorkbook.addWorksheet('Аналітика Reels');

    excelWorksheet.columns = [
        { header: 'Дата', key: 'date', width: 12 },
        { header: 'Посилання', key: 'url', width: 40 },
        { header: 'Перегляди', key: 'views', width: 15 },
        { header: 'Лайки', key: 'likes', width: 12 },
        { header: 'Коментарі', key: 'comments', width: 12 },
        { header: 'Статус', key: 'status', width: 15 }
    ];

    excelWorksheet.getRow(1).font = { bold: true };
    excelWorksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6E6FA' }
    };

    const currentDate = new Date().toLocaleDateString('uk-UA');
    let successfulRequestsCount = 0;

    for (let videoIndex = 0; videoIndex < userVideoLinks.length; videoIndex++) {
        const videoUrl = userVideoLinks[videoIndex];
        try {
            await telegramBot.editMessageText(`⏳ Обробка ${videoIndex + 1}/${userVideoLinks.length}...`, {
                chat_id: chatId,
                message_id: progressMessage.message_id
            });

            const metrics = await getReelMetricsWithLikes(videoUrl);
            
            let statusText = 'Успішно';
            if (metrics.views === 0) {
                statusText = 'Немає даних';
            }

            excelWorksheet.addRow({
                date: currentDate,
                url: videoUrl,
                views: metrics.views,
                likes: metrics.likes,
                comments: metrics.comments,
                status: statusText
            });

            if (metrics.views > 0) {
                successfulRequestsCount++;
            }

            await pauseExecution(2000);

        } catch (videoError) {
            console.error(`Помилка обробки ${videoUrl}:`, videoError.message);
            excelWorksheet.addRow({
                date: currentDate,
                url: videoUrl,
                views: 0,
                likes: 0,
                comments: 0,
                status: 'Помилка'
            });
        }
    }

    await telegramBot.deleteMessage(chatId, progressMessage.message_id);

    try {
        excelWorksheet.addRow({});
        const statisticsRow = excelWorksheet.addRow({
            date: 'СТАТИСТИКА',
            url: `Успішно: ${successfulRequestsCount}/${userVideoLinks.length}`,
            views: `Дата: ${currentDate}`,
            likes: 'GraphQL метод',
            comments: '',
            status: ''
        });
        statisticsRow.font = { bold: true, color: { argb: 'FF0000FF' } };

        const fileName = `reels_tracker_${chatId}_${Date.now()}.xlsx`;
        const filePath = path.join(DATA_DIRECTORY, fileName);
        
        await excelWorkbook.xlsx.writeFile(filePath);
        
        const fileBuffer = await fs.readFile(filePath);
        
        await telegramBot.sendDocument(chatId, fileBuffer, {}, {
            filename: `Reels_Analytics_${currentDate.replace(/\//g, '-')}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await fs.unlink(filePath).catch(() => {});

        await telegramBot.sendMessage(chatId, 
            `📊 **Звіт по Reels сформовано!**\n\n` +
            `✅ Отримано дані: ${successfulRequestsCount}/${userVideoLinks.length} відео\n` +
            `📅 Дата: ${currentDate}\n` +
            `🔄 Використано: GraphQL метод\n` +
            `📁 Файл містить: URL, перегляди, лайки, коментарі`
        );

    } catch (fileError) {
        console.error('Помилка створення файлу:', fileError);
        await telegramBot.sendMessage(chatId, '❌ Помилка при створенні звіту.');
    }
};

// ==========================================
// 👤 ОБРОБКА ЗАПИТІВ КОРИСТУВАЧІВ
// ==========================================

const handleUserApprovalRequest = async (callbackData, chatId) => {
    const dataParts = callbackData.split('_');
    const targetUserId = parseInt(dataParts[2]);
    const targetUserName = dataParts[3];

    if (!authorizedUsersList.some(user => user.id === targetUserId)) {
        authorizedUsersList.push({ 
            id: targetUserId, 
            name: targetUserName,
            approvedBy: chatId,
            approvedAt: Date.now(),
            lastActive: Date.now()
        });
        await saveAuthorizedUsers();
        
        await telegramBot.sendMessage(chatId, `✅ Користувачу ${targetUserName} надано доступ!`);
        
        try { 
            await telegramBot.sendMessage(targetUserId, 
                `🎉 **Вам надано доступ до системи SAMIParser!**\n\n` +
                `Тепер ви можете використовувати всі функції бота.\n` +
                `Натисніть /start для початку роботи.`,
                { parse_mode: 'Markdown' }
            ); 
        } catch (sendError) { 
            console.log(`Не вдалося повідомити користувача ${targetUserId}:`, sendError.message);
        }
    }
    
    await telegramBot.deleteMessage(chatId, telegramBot.callbackQuery.message.message_id);
};

const handleUserDeletionRequest = async (callbackData, chatId) => {
    const targetUserId = parseInt(callbackData.split('_')[2]);
    const initialUsersCount = authorizedUsersList.length;
    
    authorizedUsersList = authorizedUsersList.filter(user => user.id !== targetUserId);
    
    if (authorizedUsersList.length < initialUsersCount) {
        await saveAuthorizedUsers();
        await telegramBot.sendMessage(chatId, `🗑 Користувача з ID ${targetUserId} видалено з системи.`);
    } else {
        await telegramBot.sendMessage(chatId, `⚠️ Користувача з ID ${targetUserId} не знайдено.`);
    }
    
    await telegramBot.deleteMessage(chatId, telegramBot.callbackQuery.message.message_id);
};

// ==========================================
// ⚙️ НАЛАШТУВАННЯ СИСТЕМИ
// ==========================================

const displayDelaySettingsConfiguration = async (chatId) => {
    userStatesMap.set(chatId, {
        step: 'delay_settings',
        type: 'settings',
        data: {}
    });
    
    await telegramBot.sendMessage(chatId,
        `⚙️ <b>Налаштування затримок запитів</b>\n\n` +
        `Поточні значення:\n` +
        `• Стандартні: ${systemSettings.delaySettings.minimumDelay}-${systemSettings.delaySettings.maximumDelay} мс\n` +
        `• Для хештегів: ${systemSettings.delaySettings.hashtagMinimumDelay}-${systemSettings.delaySettings.hashtagMaximumDelay} мс\n` +
        `• Між пачками: ${systemSettings.delaySettings.betweenBatchesDelay} мс\n\n` +
        `✍️ Введіть нові значення у форматі:\n` +
        `<code>стандартні_мін стандартні_макс хештеги_мін хештеги_макс між_пачками</code>\n\n` +
        `<i>Приклад: 1000 2500 2000 4000 3000</i>`,
        { 
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '↩️ Скасувати зміну налаштувань' }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
};

const updateDelaySettings = async (chatId, inputText) => {
    const delayValues = inputText.split(' ').map(val => parseInt(val.trim()));
    
    if (delayValues.length !== 5 || delayValues.some(val => isNaN(val) || val < 0)) {
        return '❌ Некоректний формат введення. Використовуйте 5 чисел через пробіл.';
    }
    
    const [minDelay, maxDelay, hashtagMin, hashtagMax, betweenBatches] = delayValues;
    
    // Валідація значень
    if (minDelay >= maxDelay) {
        return '❌ Мінімальна затримка має бути меншою за максимальну.';
    }
    
    if (hashtagMin >= hashtagMax) {
        return '❌ Мінімальна затримка для хештегів має бути меншою за максимальну.';
    }
    
    if (betweenBatches < 0) {
        return '❌ Затримка між пачками не може бути від\'ємною.';
    }
    
    // Оновлюємо налаштування
    systemSettings.delaySettings = {
        minimumDelay: minDelay,
        maximumDelay: maxDelay,
        hashtagMinimumDelay: hashtagMin,
        hashtagMaximumDelay: hashtagMax,
        betweenBatchesDelay: betweenBatches
    };
    
    await saveSystemSettings();
    
    return `✅ Налаштування затримок оновлено!\n\n` +
           `Нові значення:\n` +
           `• Стандартні: ${minDelay}-${maxDelay} мс\n` +
           `• Для хештегів: ${hashtagMin}-${hashtagMax} мс\n` +
           `• Між пачками: ${betweenBatches} мс`;
};

const checkInstagramAccountsActivity = async (chatId) => {
    const progressMessage = await telegramBot.sendMessage(chatId, '🔄 Перевірка активності акаунтів Instagram...');
    
    let activeAccounts = 0;
    let inactiveAccounts = 0;
    let errorAccounts = 0;
    const results = [];
    
    for (let accountIndex = 0; accountIndex < instagramAccounts.length; accountIndex++) {
        const account = instagramAccounts[accountIndex];
        
        try {
            await telegramBot.editMessageText(
                `🔄 Перевірка акаунта ${accountIndex + 1}/${instagramAccounts.length}: ${account.username}`,
                { chat_id: chatId, message_id: progressMessage.message_id }
            );
            
            // Перевіряємо активність акаунта через запит до своєї інформації
            const originalAccountIndex = currentAccountIndex;
            currentAccountIndex = accountIndex;
            
            try {
                // Тут використовуємо звичайний запит до Instagram API
                const testResponse = await axios.get(
                    `https://www.instagram.com/api/v1/users/${account.id}/info/`,
                    {
                        headers: await InstagramAPI.igHeaders(),
                        timeout: 10000
                    }
                );
                
                if (testResponse.data?.user) {
                    account.status = 'active';
                    activeAccounts++;
                    results.push(`✅ ${account.username} - Активний`);
                } else {
                    account.status = 'inactive';
                    inactiveAccounts++;
                    results.push(`❌ ${account.username} - Неактивний`);
                }
                
            } catch (testError) {
                account.status = 'error';
                account.errorCount = (account.errorCount || 0) + 1;
                errorAccounts++;
                results.push(`⚠️ ${account.username} - Помилка: ${testError.message}`);
            }
            
            currentAccountIndex = originalAccountIndex;
            
            await pauseExecution(1000);
            
        } catch (accountError) {
            console.error(`Помилка перевірки акаунта ${account.username}:`, accountError);
        }
    }
    
    await saveInstagramAccounts();
    await telegramBot.deleteMessage(chatId, progressMessage.message_id);
    
    const summaryMessage = `
<b>📊 Результати перевірки активності акаунтів</b>

✅ <b>Активних:</b> ${activeAccounts}
❌ <b>Неактивних:</b> ${inactiveAccounts}
⚠️ <b>З помилками:</b> ${errorAccounts}
👤 <b>Всього:</b> ${instagramAccounts.length}

<b>Детальні результати:</b>
${results.slice(0, 20).join('\n')}
${results.length > 20 ? `\n... та ще ${results.length - 20} акаунтів` : ''}

<b>Рекомендації:</b>
${inactiveAccounts > 0 ? '• Деактивуйте неактивні акаунти в налаштуваннях\n' : ''}
${errorAccounts > 0 ? '• Перевірте акаунти з помилками та оновіть кукіси\n' : ''}
• Додавайте нові акаунти для покращення стабільності
    `.trim();
    
    // Якщо результатів багато, відправляємо файлом
    if (results.length > 30) {
        const fileName = `accounts_check_${Date.now()}.txt`;
        const filePath = path.join(DATA_DIRECTORY, fileName);
        await fs.writeFile(filePath, results.join('\n'));
        
        const fileBuffer = await fs.readFile(filePath);
        await telegramBot.sendDocument(chatId, fileBuffer, {}, {
            filename: fileName,
            contentType: 'text/plain',
            caption: summaryMessage,
            parse_mode: 'HTML'
        });
        
        await fs.unlink(filePath);
    } else {
        await telegramBot.sendMessage(chatId, summaryMessage, { parse_mode: 'HTML' });
    }
};

// ==========================================
// 🤖 ОБРОБНИКИ ПОВІДОМЛЕНЬ TELEGRAM БОТА
// ==========================================

telegramBot.onText(/\/start/, async (message) => {
    const chatIdentifier = message.chat.id;
    
    await loadAuthorizedUsers();
    
    if (!userHasAccess(chatIdentifier)) {
        return telegramBot.sendMessage(chatIdentifier,
            '🔒 <b>Доступ до системи обмежено</b>\n\n' +
            'Цей бот призначений для приватного використання.\n' +
            'Для отримання доступу необхідно надіслати запит адміністратору системи.',
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔑 Надіслати запит на отримання доступу', callback_data: 'request_system_access' }]
                    ]
                }
            }
        );
    }
    
    const mainMenuKeyboard = {
        keyboard: [
            ['👥 Парсинг підписників профілю', '📋 Парсинг підписок профілю'],
            ['#️⃣ Пошук користувачів за хештегом', '📹 Відстеження статистики Reels'],
            ['⚙️ Налаштування системи', '📊 Статистика роботи'],
            ['📚 Довідка та інструкції']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await telegramBot.sendMessage(chatIdentifier,
        '✨ <b>Ласкаво просимо до системи SAMIParser!</b>\n\n' +
        '🚀 <i>Потужний інструмент для аналізу та парсингу даних з Instagram</i>\n\n' +
        'Оберіть потрібну дію з головного меню нижче:',
        {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard
        }
    );
});

telegramBot.onText(/\/settings/, async (message) => {
    const chatIdentifier = message.chat.id;
    if (!userIsAdministrator(chatIdentifier)) return;
    
    const settingsKeyboard = {
        inline_keyboard: [
            [{ text: '⏱ Налаштування затримок запитів', callback_data: 'account_delay_settings' }],
            [{ text: '🔧 Налаштування лімітів обробки', callback_data: 'settings_processing_limits' }],
            [{ text: '👤 Керування акаунтами Instagram', callback_data: 'account_list_display' }],
            [{ text: '📊 Скинути статистику використання', callback_data: 'settings_reset_statistics' }],
            [{ text: '🔄 Перевірити активність акаунтів', callback_data: 'account_activity_check' }]
        ]
    };
    
    await telegramBot.sendMessage(chatIdentifier,
        '⚙️ <b>Налаштування системи SAMIParser</b>\n\n' +
        `• Максимальна кількість одночасних запитів: ${systemSettings.concurrencyLimit}\n` +
        `• Максимальна кількість запитів для хештегів: ${systemSettings.hashtagConcurrencyLimit}\n` +
        `• Ротація акаунта після: ${systemSettings.requestLimitBeforeRotation} запитів\n\n` +
        `⏱ <b>Налаштування затримок:</b>\n` +
        `• Стандартні затримки: ${systemSettings.delaySettings.minimumDelay}-${systemSettings.delaySettings.maximumDelay} мс\n` +
        `• Затримки для хештегів: ${systemSettings.delaySettings.hashtagMinimumDelay}-${systemSettings.delaySettings.hashtagMaximumDelay} мс\n` +
        `• Затримка між пачками обробки: ${systemSettings.delaySettings.betweenBatchesDelay} мс`,
        { parse_mode: 'HTML', reply_markup: settingsKeyboard }
    );
});

telegramBot.onText(/\/accounts/, async (message) => {
    const chatIdentifier = message.chat.id;
    await displayAccountsManagementMenu(chatIdentifier);
});

telegramBot.onText(/\/stats/, async (message) => {
    const chatIdentifier = message.chat.id;
    if (!userHasAccess(chatIdentifier)) return;
    await displaySystemStatistics(chatIdentifier);
});

telegramBot.onText(/\/help/, async (message) => {
    const chatIdentifier = message.chat.id;
    
    const helpInformationText = `
<b>📚 Довідка та інструкції для системи SAMIParser</b>

<b>Основні функціональні можливості:</b>
• 👥 <b>Парсинг підписників профілю</b> - отримання повного списку аудиторії вказаного профілю
• 📋 <b>Парсинг підписок профілю</b> - аналіз користувачів, на яких підписаний вказаний профіль
• #️⃣ <b>Пошук користувачів за хештегом</b> - пошук авторів контенту за конкретним хештегом
• 📹 <b>Відстеження статистики Reels</b> - моніторинг переглядів, лайків та коментарів для відео

<b>Покрокова інструкція використання:</b>
1. Оберіть бажаний тип парсингу з головного меню
2. Введіть ім'я користувача Instagram або хештег для пошуку
3. Вкажіть мінімальну кількість підписників для фільтрації результатів
4. Вкажіть максимальну кількість підписників (опціонально)
5. Вкажіть ліміт обробки користувачів
6. Очікуйте завершення обробки та отримайте файл Excel з результатами

<b>Корисні рекомендації та поради:</b>
• Для пошуку за хештегами рекомендуємо використовувати англійські назви
• Мінімальна кількість підписників для фільтрації - рекомендується від 1000
• Між великими за обсягом парсингами робіть технічні перерви 5-10 хвилин
• Для стабільної роботи рекомендується обробляти не більше 1000 користувачів за раз

<b>Функції для адміністраторів системи:</b>
• /accounts - керування акаунтами Instagram для парсингу
• /settings - налаштування параметрів роботи системи
• /stats - перегляд детальної статистики роботи

<b>Отримання технічної підтримки:</b>
У разі виникнення технічних проблем або питань звертайтесь до адміністратора системи.
    `.trim();
    
    await telegramBot.sendMessage(chatIdentifier, helpInformationText, { parse_mode: 'HTML' });
});

telegramBot.on('message', async (message) => {
    const chatIdentifier = message.chat.id;
    const messageText = message.text;
    
    if (!messageText || messageText.startsWith('/')) return;
    if (!userHasAccess(chatIdentifier)) return;
    
    // Обробка поточного стану користувача
    const userCurrentState = userStatesMap.get(chatIdentifier);
    if (userCurrentState) {
        await handleUserCurrentState(chatIdentifier, messageText, userCurrentState);
        return;
    }
    
    // Обробка посилань на Reels
    if (messageText.includes('instagram.com/reel/') || messageText.includes('instagram.com/p/')) {
        reelsTrackingDatabase[chatIdentifier] = reelsTrackingDatabase[chatIdentifier] || [];
        const cleanVideoLink = messageText.split('?')[0].trim();
        
        if (!reelsTrackingDatabase[chatIdentifier].includes(cleanVideoLink)) {
            reelsTrackingDatabase[chatIdentifier].push(cleanVideoLink);
            await saveReelsTrackingDatabase();
            await telegramBot.sendMessage(chatIdentifier,
                `✅ <b>Посилання на відео успішно додано!</b>\n\n` +
                `🔗 ${cleanVideoLink}\n` +
                `📊 Загальна кількість відстежуваних відео: ${reelsTrackingDatabase[chatIdentifier].length}`,
                { parse_mode: 'HTML' }
            );
        }
        return;
    }
    
    // Обробка вибору пунктів головного меню
    switch (messageText) {
        case '👥 Парсинг підписників профілю':
            await startParsingProcedure(chatIdentifier, 'followers');
            break;
            
        case '📋 Парсинг підписок профілю':
            await startParsingProcedure(chatIdentifier, 'following');
            break;
            
        case '#️⃣ Пошук користувачів за хештегом':
            await startParsingProcedure(chatIdentifier, 'hashtag');
            break;
            
        case '📹 Відстеження статистики Reels':
            await displayReelsTrackerInterface(chatIdentifier);
            break;
            
        case '⚙️ Налаштування системи':
            if (userIsAdministrator(chatIdentifier)) {
                telegramBot.sendMessage(chatIdentifier, 'Оберіть потрібну дію:', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👤 Керування акаунтами Instagram', callback_data: 'account_list_display' }],
                            [{ text: '⚙️ Налаштування параметрів системи', callback_data: 'settings_main_menu' }],
                            [{ text: '📊 Перегляд статистики роботи', callback_data: 'statistics_main_menu' }]
                        ]
                    }
                });
            }
            break;
            
        case '📊 Статистика роботи':
            await displaySystemStatistics(chatIdentifier);
            break;
            
        case '📚 Довідка та інструкції':
            telegramBot.sendMessage(chatIdentifier, 'Для отримання повної інформації використовуйте команду /help');
            break;
            
        case '↩️ Скасувати додавання акаунта':
        case '↩️ Скасувати парсинг':
        case '↩️ Скасувати зміну налаштувань':
            userStatesMap.delete(chatIdentifier);
            telegramBot.sendMessage(chatIdentifier, '❌ Операцію скасовано', {
                reply_markup: { remove_keyboard: true }
            });
            break;
    }
});

async function handleUserCurrentState(chatId, inputText, currentState) {
    try {
        switch (currentState.step) {
            case 'adding_new_account':
                if (inputText === '↩️ Скасувати додавання акаунта') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Процес додавання нового акаунта Instagram скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                try {
                    const parsedCookieData = parseInstagramCookieString(inputText);
                    const accountIdentifier = parsedCookieData.ds_user_id;
                    
                    // Перевіряємо, чи не існує вже акаунт з таким ідентифікатором
                    if (instagramAccounts.some(account => account.id === accountIdentifier)) {
                        return telegramBot.sendMessage(chatId, '❌ Акаунт з таким ідентифікатором вже додано до системи!');
                    }
                    
                    // Створюємо новий об'єкт акаунта
                    const newInstagramAccount = {
                        id: accountIdentifier,
                        username: `instagram_account_${accountIdentifier.slice(-4)}`,
                        cookie: inputText,
                        ...parsedCookieData,
                        status: 'active',
                        lastUsedTimestamp: Date.now(),
                        totalRequestsCount: 0,
                        errorCount: 0,
                        addedTimestamp: Date.now()
                    };
                    
                    instagramAccounts.push(newInstagramAccount);
                    await saveInstagramAccounts();
                    
                    userStatesMap.delete(chatId);
                    
                    await telegramBot.sendMessage(chatId,
                        `✅ <b>Новий акаунт Instagram успішно додано до системи!</b>\n\n` +
                        `👤 Ідентифікатор акаунта: ${accountIdentifier}\n` +
                        `🆔 Ім'я користувача: ${newInstagramAccount.username}\n` +
                        `📊 Статус акаунта: Активний\n\n` +
                        `Тепер система має доступ до ${instagramAccounts.length} акаунтів Instagram.`,
                        { 
                            parse_mode: 'HTML',
                            reply_markup: { remove_keyboard: true }
                        }
                    );
                    
                } catch (cookieParsingError) {
                    await telegramBot.sendMessage(chatId,
                        `❌ <b>Помилка аналізу наданого рядка кукісів:</b>\n` +
                        `<code>${escapeHtmlSpecialCharacters(cookieParsingError.message)}</code>\n\n` +
                        `Будь ласка, перевірте правильність введених даних та спробуйте ще раз.`,
                        { parse_mode: 'HTML' }
                    );
                }
                break;
                
            case 'entering_source':
                if (inputText === '↩️ Скасувати парсинг') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Процес парсингу скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                currentState.source = inputText.trim();
                currentState.step = 'entering_minimum_followers';
                
                const sourceTypeDescription = currentState.type === 'hashtag' ? 'хештег' : 'ім\'я користувача';
                
                await telegramBot.sendMessage(chatId,
                    `✅ <b>Джерело для парсингу прийнято!</b>\n\n` +
                    `${currentState.type === 'hashtag' ? '#' : '@'}${escapeHtmlSpecialCharacters(currentState.source)}\n\n` +
                    `✍️ <b>Крок 2 з 4</b>\n` +
                    `Введіть мінімальну кількість підписників для фільтрації результатів:\n` +
                    `<i>(рекомендоване значення - від 1000 підписників)</i>`,
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            keyboard: [[{ text: '1000' }, { text: '5000' }, { text: '10000' }], [{ text: '↩️ Скасувати парсинг' }]],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;
                
            case 'entering_minimum_followers':
                if (inputText === '↩️ Скасувати парсинг') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Процес парсингу скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                const minimumFollowers = parseInt(inputText);
                if (isNaN(minimumFollowers) || minimumFollowers < 1) {
                    return telegramBot.sendMessage(chatId, '❌ Будь ласка, введіть коректне числове значення (більше 0)');
                }
                
                currentState.min = minimumFollowers;
                currentState.step = 'entering_maximum_followers';
                
                await telegramBot.sendMessage(chatId,
                    `✅ <b>Мінімальна кількість підписників встановлена: ${minimumFollowers}</b>\n\n` +
                    `✍️ <b>Крок 3 з 4</b>\n` +
                    `Введіть максимальну кількість підписників (або 0 для відсутності обмеження):\n` +
                    `<i>(приклад: 500000 або 0 для без обмежень)</i>`,
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            keyboard: [[{ text: '0' }, { text: '100000' }, { text: '500000' }], [{ text: '1000000' }, { text: '5000000' }], [{ text: '↩️ Скасувати парсинг' }]],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;
                
            case 'entering_maximum_followers':
                if (inputText === '↩️ Скасувати парсинг') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Процес парсингу скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                const maximumFollowers = parseInt(inputText);
                if (isNaN(maximumFollowers) || maximumFollowers < 0) {
                    return telegramBot.sendMessage(chatId, '❌ Будь ласка, введіть коректне числове значення (0 або більше)');
                }
                
                currentState.max = maximumFollowers === 0 ? DEFAULT_MAXIMUM_FOLLOWERS : maximumFollowers;
                currentState.step = 'entering_limit';
                
                await telegramBot.sendMessage(chatId,
                    `✅ <b>Максимальна кількість підписників встановлена: ${maximumFollowers === 0 ? 'без обмежень' : maximumFollowers}</b>\n\n` +
                    `✍️ <b>Крок 4 з 4</b>\n` +
                    `Введіть максимальну кількість користувачів для обробки:\n` +
                    `<i>(рекомендоване значення - до 1000 користувачів)</i>`,
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            keyboard: [[{ text: '500' }, { text: '1000' }, { text: '2000' }], [{ text: '↩️ Скасувати парсинг' }]],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;
                
            case 'entering_limit':
                if (inputText === '↩️ Скасувати парсинг') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Процес парсингу скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                const processingLimit = parseInt(inputText);
                if (isNaN(processingLimit) || processingLimit < 1 || processingLimit > 5000) {
                    return telegramBot.sendMessage(chatId, '❌ Будь ласка, введіть числове значення в діапазоні від 1 до 5000');
                }
                
                currentState.limit = processingLimit;
                
                // Завершуємо процес налаштування та запускаємо парсинг
                userStatesMap.delete(chatId);
                
                // Повертаємо основну клавіатуру меню
                await telegramBot.sendMessage(chatId, '🚀 Запуск процесу парсингу даних...', {
                    reply_markup: {
                        keyboard: [
                            ['👥 Парсинг підписників профілю', '📋 Парсинг підписок профілю'],
                            ['#️⃣ Пошук користувачів за хештегом', '📹 Відстеження статистики Reels'],
                            ['⚙️ Налаштування системи', '📊 Статистика роботи'],
                            ['📚 Довідка та інструкції']
                        ],
                        resize_keyboard: true
                    }
                });
                
                await executeScrapingProcess(chatId, currentState);
                break;
                
            case 'delay_settings':
                if (inputText === '↩️ Скасувати зміну налаштувань') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Зміну налаштувань затримок скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                const updateResult = await updateDelaySettings(chatId, inputText);
                userStatesMap.delete(chatId);
                
                await telegramBot.sendMessage(chatId, updateResult, {
                    parse_mode: 'HTML',
                    reply_markup: { remove_keyboard: true }
                });
                break;
                
            case 'processing_limits':
                if (inputText === '↩️ Скасувати зміну налаштувань') {
                    userStatesMap.delete(chatId);
                    return telegramBot.sendMessage(chatId, '❌ Зміну налаштувань лімітів скасовано', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                
                const limitUpdateResult = await updateProcessingLimits(chatId, inputText);
                userStatesMap.delete(chatId);
                
                await telegramBot.sendMessage(chatId, limitUpdateResult, {
                    parse_mode: 'HTML',
                    reply_markup: { remove_keyboard: true }
                });
                break;
        }
    } catch (stateProcessingError) {
        console.error('Критична помилка обробки стану користувача:', stateProcessingError);
        userStatesMap.delete(chatId);
        await telegramBot.sendMessage(chatId, `❌ Помилка обробки: ${stateProcessingError.message}`);
    }
}

async function startParsingProcedure(chatId, parsingType) {
    const parsingTypeDescriptions = {
        followers: 'підписників профілю',
        following: 'підписок профілю',
        hashtag: 'користувачів за хештегом'
    };
    
    const parsingInstructions = {
        followers: 'Введіть ім\'я користувача Instagram (без символу @):',
        following: 'Введіть ім\'я користувача Instagram (без символу @):',
        hashtag: 'Введіть хештег для пошуку (без символу #, підтримується кирилиця):'
    };
    
    userStatesMap.set(chatId, {
        step: 'entering_source',
        type: parsingType,
        source: null,
        min: null,
        max: DEFAULT_MAXIMUM_FOLLOWERS,
        limit: null
    });
    
    await telegramBot.sendMessage(chatId,
        `🎯 <b>Запуск парсингу ${parsingTypeDescriptions[parsingType]}</b>\n\n` +
        `${parsingInstructions[parsingType]}\n\n` +
        `<i>Приклад введення: ${parsingType === 'hashtag' ? 'україна' : 'instagram'}</i>`,
        { 
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '↩️ Скасувати парсинг' }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
}

async function displayReelsTrackerInterface(chatId) {
    const userVideoLinks = reelsTrackingDatabase[chatId] || [];
    
    const trackerMessage = `
📹 <b>Система відстеження статистики Reels</b>

🔗 <b>Поточна кількість відстежуваних відео:</b> ${userVideoLinks.length}

<b>Доступні функції:</b>
• Надішліть посилання на Reels для додавання до списку відстеження
• Оновлюйте статистичні дані щоденно
• Експортуйте зібрані дані у форматі Excel

<b>Інструкція додавання відео:</b>
Просто відправте повне посилання на відео у такому форматі:
<code>https://www.instagram.com/reel/ABC123XYZ...</code>
    `.trim();
    
    const trackerKeyboard = {
        inline_keyboard: [
            [{ text: '📊 Оновити статистичні дані', callback_data: 'reels_update_statistics' }],
            [{ text: '📜 Переглянути список відео', callback_data: 'reels_display_list' }],
            [{ text: '📥 Експорт даних в Excel', callback_data: 'reels_export_excel' }],
            [{ text: '🗑 Очистити весь список', callback_data: 'reels_clear_all' }]
        ]
    };
    
    if (userVideoLinks.length > 0) {
        trackerKeyboard.inline_keyboard.unshift([
            { text: `🔄 Оновити статистику (${userVideoLinks.length})`, callback_data: 'reels_update_statistics' }
        ]);
    }
    
    await telegramBot.sendMessage(chatId, trackerMessage, {
        parse_mode: 'HTML',
        reply_markup: trackerKeyboard,
        disable_web_page_preview: true
    });
}

// ==========================================
// 🔘 ОБРОБНИКИ CALLBACK QUERY ДЛЯ TELEGRAM БОТА
// ==========================================

telegramBot.on('callback_query', async (callbackQuery) => {
    const chatIdentifier = callbackQuery.message.chat.id;
    const callbackData = callbackQuery.data;
    const userInformation = callbackQuery.from;

    try {
        await telegramBot.answerCallbackQuery(callbackQuery.id);

        if (callbackData === 'request_system_access') {
            await handleSystemAccessRequest(chatIdentifier, userInformation, callbackQuery.message.message_id);
            return;
        }

        if (callbackData.startsWith('account_')) {
            await handleAccountManagementCallback(chatIdentifier, callbackData);
            return;
        }

        if (callbackData.startsWith('settings_')) {
            await handleSettingsManagementCallback(chatIdentifier, callbackData);
            return;
        }

        if (callbackData.startsWith('reels_')) {
            await handleReelsTrackerCallback(chatIdentifier, callbackData);
            return;
        }

        if (callbackData.startsWith('approve_user_')) {
            if (!userIsAdministrator(chatIdentifier)) return;
            await handleUserApprovalRequest(callbackData, chatIdentifier);
            return;
        }

        if (callbackData.startsWith('deny_user_')) {
            if (!userIsAdministrator(chatIdentifier)) return;
            await telegramBot.deleteMessage(chatIdentifier, callbackQuery.message.message_id);
            return;
        }

        if (callbackData.startsWith('delete_user_')) {
            if (!userIsAdministrator(chatIdentifier)) return;
            await handleUserDeletionRequest(callbackData, chatIdentifier);
            return;
        }

    } catch (callbackError) {
        console.error('Критична помилка обробки callback запиту:', callbackError);
        await telegramBot.sendMessage(chatIdentifier, '❌ Сталася помилка при обробці вашого запиту');
    }
});

async function handleSystemAccessRequest(chatId, userInfo, messageId) {
    await telegramBot.editMessageText('⏳ Запит на отримання доступу надіслано адміністраторам системи...', {
        chat_id: chatId,
        message_id: messageId
    });

    const failedAdministrators = [];
    for (const administratorId of ADMINISTRATOR_IDS) {
        try {
            await telegramBot.sendMessage(administratorId,
                `🔔 <b>Новий запит на отримання доступу до системи!</b>\n\n` +
                `👤 <b>Інформація про користувача:</b>\n` +
                `• Ім'я: ${escapeHtmlSpecialCharacters(userInfo.first_name || '')} ${escapeHtmlSpecialCharacters(userInfo.last_name || '')}\n` +
                `• Користувач в Telegram: ${userInfo.username ? '@' + escapeHtmlSpecialCharacters(userInfo.username) : 'не вказано'}\n` +
                `• Ідентифікатор чату: <code>${userInfo.id}</code>\n\n` +
                `📅 <i>Час надсилання запиту: ${new Date().toLocaleString('uk-UA')}</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Надати доступ', callback_data: `approve_user_${userInfo.id}_${userInfo.first_name || userInfo.username || 'Користувач'}` },
                                { text: '🚫 Відмовити у доступі', callback_data: `deny_user_${userInfo.id}` }
                            ]
                        ]
                    }
                }
            );
        } catch (sendError) {
            failedAdministrators.push(administratorId);
        }
    }

    if (failedAdministrators.length === ADMINISTRATOR_IDS.length) {
        await telegramBot.sendMessage(chatId, '❌ Не вдалося надіслати запит адміністраторам системи');
    } else {
        await telegramBot.sendMessage(chatId, '✅ Запит на отримання доступу успішно відправлено. Очікуйте рішення адміністратора.');
    }
}

async function handleAccountManagementCallback(chatId, callbackData) {
    if (!userIsAdministrator(chatId)) return;

    switch (callbackData) {
        case 'account_list_display':
            await displayInstagramAccountsList(chatId);
            break;
            
        case 'account_add_new':
            await addNewInstagramAccount(chatId);
            break;
            
        case 'account_usage_statistics':
            await displayAccountsUsageStatistics(chatId);
            break;
            
        case 'account_activity_check':
            await checkInstagramAccountsActivity(chatId);
            break;
            
        case 'account_delay_settings':
            await displayDelaySettingsConfiguration(chatId);
            break;
            
        case 'account_details_0':
        case 'account_details_1':
        case 'account_details_2':
        case 'account_details_3':
        case 'account_details_4':
            const accountIndex = parseInt(callbackData.split('_')[2]);
            await displayAccountDetails(chatId, accountIndex);
            break;
    }
}

async function displayInstagramAccountsList(chatId) {
    const accountButtons = [];
    
    instagramAccounts.forEach((account, index) => {
        accountButtons.push([
            { 
                text: `${account.status === 'active' ? '🟢' : '🔴'} ${account.username} (${account.totalRequestsCount || 0})`,
                callback_data: `account_details_${index}`
            }
        ]);
    });
    
    accountButtons.push([{ text: '➕ Додати новий акаунт', callback_data: 'account_add_new' }]);
    accountButtons.push([{ text: '📊 Статистика використання', callback_data: 'account_usage_statistics' }]);
    
    await telegramBot.sendMessage(chatId,
        `👤 <b>Список акаунтів Instagram</b>\n\n` +
        `Загальна кількість: ${instagramAccounts.length}\n` +
        `Активних: ${instagramAccounts.filter(a => a.status === 'active').length}\n\n` +
        `Оберіть акаунт для перегляду деталей:`,
        {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: accountButtons }
        }
    );
}

async function displayAccountDetails(chatId, accountIndex) {
    if (accountIndex < 0 || accountIndex >= instagramAccounts.length) {
        return telegramBot.sendMessage(chatId, '❌ Акаунт не знайдено');
    }
    
    const account = instagramAccounts[accountIndex];
    const isActive = account.status === 'active';
    const isCurrent = currentAccountIndex === accountIndex;
    
    const accountDetails = `
<b>📋 Детальна інформація про акаунт</b>

👤 <b>Основна інформація:</b>
• Ім'я користувача: ${account.username}
• Ідентифікатор: ${account.id}
• Статус: ${isActive ? '🟢 Активний' : '🔴 Неактивний'} ${isCurrent ? '(Поточний)' : ''}
• Дата додавання: ${new Date(account.addedTimestamp).toLocaleString('uk-UA')}

📊 <b>Статистика використання:</b>
• Виконано запитів: ${account.totalRequestsCount || 0}
• Кількість помилок: ${account.errorCount || 0}
• Остання активність: ${new Date(account.lastUsedTimestamp).toLocaleString('uk-UA')}

⚙️ <b>Доступні дії:</b>
    `.trim();
    
    const accountButtons = {
        inline_keyboard: [
            [
                { text: isActive ? '🔴 Деактивувати' : '🟢 Активувати', callback_data: `account_toggle_${accountIndex}` },
                { text: '🗑 Видалити', callback_data: `account_delete_${accountIndex}` }
            ],
            [
                { text: '📋 Список акаунтів', callback_data: 'account_list_display' },
                { text: '🔄 Зробити поточним', callback_data: `account_set_current_${accountIndex}` }
            ]
        ]
    };
    
    await telegramBot.sendMessage(chatId, accountDetails, {
        parse_mode: 'HTML',
        reply_markup: accountButtons
    });
}

async function displayAccountsUsageStatistics(chatId) {
    const activeInstagramAccounts = instagramAccounts.filter(account => account.status === 'active');
    const totalRequestsCount = instagramAccounts.reduce((sum, account) => sum + (account.totalRequestsCount || 0), 0);
    const averageRequestsPerAccount = activeInstagramAccounts.length > 0 ? Math.round(totalRequestsCount / activeInstagramAccounts.length) : 0;
    
    const currentTime = Date.now();
    const twentyFourHoursAgo = currentTime - (24 * 60 * 60 * 1000);
    const recentlyActiveAccounts = instagramAccounts.reduce((sum, account) => 
        sum + ((account.lastUsedTimestamp > twentyFourHoursAgo) ? 1 : 0), 0);
    
    const statisticsMessage = `
📊 <b>Детальна статистика використання акаунтів Instagram</b>

👤 <b>Загальна інформація:</b>
• Всього акаунтів у системі: ${instagramAccounts.length}
• Активних акаунтів: ${activeInstagramAccounts.length}
• Неактивних акаунтів: ${instagramAccounts.length - activeInstagramAccounts.length}

📈 <b>Аналіз активності:</b>
• Загальна кількість виконаних запитів: ${totalRequestsCount}
• Середня кількість запитів на акаунт: ${averageRequestsPerAccount}
• Акаунтів з активністю за останні 24 години: ${recentlyActiveAccounts}

🔄 <b>Інформація про поточний акаунт:</b>
• Ім'я користувача: ${'instagram_api_user' || 'Не визначено'}
• Позиція в ротації: ${currentAccountIndex + 1}/${instagramAccounts.length}
• Виконано запитів: ${totalRequestsCount || 0}

⚙️ <b>Рекомендації щодо управління акаунтами:</b>
• Додавайте додаткові акаунти для підвищення стабільності роботи
• Регулярно перевіряйте активність акаунтів (щодня)
• Деактивовуйте акаунти, які викликають помилки або обмеження
    `.trim();
    
    await telegramBot.sendMessage(chatId, statisticsMessage, { parse_mode: 'HTML' });
}

async function handleSettingsManagementCallback(chatId, callbackData) {
    if (!userIsAdministrator(chatId)) return;

    switch (callbackData) {
        case 'settings_request_delays':
        case 'account_delay_settings':
            await displayDelaySettingsConfiguration(chatId);
            break;
            
        case 'settings_processing_limits':
            await displayProcessingLimitsSettings(chatId);
            break;
            
        case 'settings_reset_statistics':
            await resetSystemStatistics(chatId);
            break;
            
        case 'settings_main_menu':
            await telegramBot.sendMessage(chatId, 'Оберіть розділ налаштувань:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏱ Затримки запитів', callback_data: 'settings_request_delays' }],
                        [{ text: '🔧 Ліміти обробки', callback_data: 'settings_processing_limits' }],
                        [{ text: '📊 Скинути статистику', callback_data: 'settings_reset_statistics' }],
                        [{ text: '👤 Акаунти Instagram', callback_data: 'account_list_display' }]
                    ]
                }
            });
            break;
    }
}

async function displayProcessingLimitsSettings(chatId) {
    userStatesMap.set(chatId, {
        step: 'processing_limits',
        type: 'settings',
        data: {}
    });
    
    await telegramBot.sendMessage(chatId,
        `🔧 <b>Налаштування лімітів обробки</b>\n\n` +
        `Поточні значення:\n` +
        `• Конкурентність: ${systemSettings.concurrencyLimit}\n` +
        `• Конкурентність хештегів: ${systemSettings.hashtagConcurrencyLimit}\n` +
        `• Ротація через: ${systemSettings.requestLimitBeforeRotation} запитів\n\n` +
        `✍️ Введіть нові значення у форматі:\n` +
        `<code>конкурентність конкурентність_хештегів ротація_через</code>\n\n` +
        `<i>Приклад: 2 1 15</i>`,
        { 
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '↩️ Скасувати зміну налаштувань' }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
}

async function updateProcessingLimits(chatId, inputText) {
    const limitValues = inputText.split(' ').map(val => parseInt(val.trim()));
    
    if (limitValues.length !== 3 || limitValues.some(val => isNaN(val) || val < 1)) {
        return '❌ Некоректний формат введення. Використовуйте 3 числа через пробіл (мінімум 1).';
    }
    
    const [concurrency, hashtagConcurrency, rotationLimit] = limitValues;
    
    // Валідація значень
    if (concurrency > 10) {
        return '❌ Конкурентність не може перевищувати 10.';
    }
    
    if (hashtagConcurrency > 5) {
        return '❌ Конкурентність для хештегів не може перевищувати 5.';
    }
    
    if (rotationLimit > 100) {
        return '❌ Ліміт ротації не може перевищувати 100 запитів.';
    }
    
    // Оновлюємо налаштування
    systemSettings.concurrencyLimit = concurrency;
    systemSettings.hashtagConcurrencyLimit = hashtagConcurrency;
    systemSettings.requestLimitBeforeRotation = rotationLimit;
    
    await saveSystemSettings();
    
    return `✅ Налаштування лімітів оновлено!\n\n` +
           `Нові значення:\n` +
           `• Конкурентність: ${concurrency}\n` +
           `• Конкурентність хештегів: ${hashtagConcurrency}\n` +
           `• Ротація через: ${rotationLimit} запитів`;
}

async function resetSystemStatistics(chatId) {
    // Скидаємо статистику акаунтів
    instagramAccounts.forEach(account => {
        account.totalRequestsCount = 0;
        account.errorCount = 0;
    });
    
    await saveInstagramAccounts();
    
    await telegramBot.sendMessage(chatId,
        '✅ Статистика використання акаунтів успішно скинута!\n\n' +
        'Всі лічильники запитів та помилок обнулені.',
        { parse_mode: 'HTML' }
    );
}

async function handleReelsTrackerCallback(chatId, callbackData) {
    switch (callbackData) {
        case 'reels_update_statistics':
            await sendReelsTrackerReport(chatId);
            break;
            
        case 'reels_display_list':
            await displayReelsList(chatId);
            break;
            
        case 'reels_export_excel':
            await exportReelsToExcel(chatId);
            break;
            
        case 'reels_clear_all':
            await clearReelsList(chatId);
            break;
    }
}

async function displayReelsList(chatId) {
    const videoLinks = reelsTrackingDatabase[chatId] || [];
    
    if (!videoLinks.length) {
        return telegramBot.sendMessage(chatId, '📭 Ваш список відстеження Reels порожній.');
    }
    
    let linksText = `<b>📹 Список відстежуваних відео:</b>\n\n`;
    
    videoLinks.forEach((link, index) => {
        linksText += `${index + 1}. ${link}\n`;
    });
    
    // Якщо список довгий, відправляємо файлом
    if (videoLinks.length > 20) {
        const fileName = `reels_list_${Date.now()}.txt`;
        const filePath = path.join(DATA_DIRECTORY, fileName);
        await fs.writeFile(filePath, videoLinks.join('\n'));
        
        const fileBuffer = await fs.readFile(filePath);
        await telegramBot.sendDocument(chatId, fileBuffer, {}, {
            filename: fileName,
            contentType: 'text/plain',
            caption: `📹 Список з ${videoLinks.length} відео`
        });
        
        await fs.unlink(filePath);
    } else {
        await telegramBot.sendMessage(chatId, linksText, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }
}

async function exportReelsToExcel(chatId) {
    await sendReelsTrackerReport(chatId);
}

async function clearReelsList(chatId) {
    reelsTrackingDatabase[chatId] = [];
    await saveReelsTrackingDatabase();
    
    await telegramBot.sendMessage(chatId,
        '🗑 Список відстеження Reels успішно очищено!\n\n' +
        'Всі посилання на відео видалені.',
        { parse_mode: 'HTML' }
    );
}

// ==========================================
// 🚀 ІНІЦІАЛІЗАЦІЯ ТА ЗАПУСК СИСТЕМИ
// ==========================================

async function initializeCompleteSystem() {
    try {
        console.log('🚀 Початок ініціалізації системи SAMIParser...');
        
        // Створюємо директорію для даних, якщо вона не існує
        await fs.mkdir(DATA_DIRECTORY, { recursive: true });
        
        await loadAuthorizedUsers();
        await setupBotCommandMenu();
        
        console.log('✅ Система SAMIParser успішно ініціалізована та готова до роботи');
        console.log(`📊 Авторизованих користувачів: ${authorizedUsersList.length}`);
        
    } catch (initializationError) {
        console.error('❌ Критична помилка ініціалізації системи:', initializationError);
        process.exit(1);
    }
}

const testInstagramConnection = async () => {
    console.log('🧪 Тестування підключення до Instagram...');
    
    try {
        // Тестуємо запит до своїх даних
        const testUser = await InstagramAPI.getUserById('12137273349');
        
        if (testUser) {
            console.log('✅ Підключення до Instagram успішне!');
            console.log(`👤 Користувач: ${testUser.username}`);
            console.log(`👥 Підписників: ${testUser.follower_count}`);
            return true;
        } else {
            console.log('⚠️ Відповідь отримана, але дані користувача відсутні');
            return false;
        }
    } catch (error) {
        console.error('❌ Помилка підключення до Instagram:', error.message);
        return false;
    }
};

// Додаємо тест підключення при запуску
initializeCompleteSystem().then(async () => {
    console.log('🤖 Телеграм бот SAMIParser успішно запущено та готовий до роботи!');
    
    // Тестуємо підключення
    await testInstagramConnection();
    
    // Запускаємо періодичну перевірку акаунтів (кожні 24 години)
    setInterval(async () => {
        try {
            console.log('🔄 Автоматична перевірка підключення до Instagram...');
            await testInstagramConnection();
        } catch (intervalError) {
            console.error('Помилка автоматичної перевірки:', intervalError);
        }
    }, 24 * 60 * 60 * 1000);
    
}).catch(initializationError => {
    console.error('🔥 Неможливо ініціалізувати систему SAMIParser:', initializationError);
});