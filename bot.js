import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import { detectAll } from 'tinyld';
import pLimit from 'p-limit';

// ==========================================
// ⚙️ КОНФІГУРАЦІЯ
// ==========================================

const token = process.env.TELEGRAM_BOT_TOKEN;

// АДМІНІСТРАТОРИ (ID)
const ADMIN_IDS = [8382862311, 8469943654];

// ШЛЯХИ (RAILWAY PERSISTENCE)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REELS_DB_FILE = path.join(DATA_DIR, 'reels_db.json');

// НАЛАШТУВАННЯ ПАРСИНГУ
const DEFAULT_LIMIT = 1300;
const DEFAULT_MAX_FOLLOWERS = 1000000000;
const CONCURRENCY_LIMIT = 3; // Зменшив до 3 для стабільності на одному акаунті

// ==========================================
// 🍪 ACCOUNT POOL & ROTATION LOGIC
// ==========================================

const ACC_POOL = [
    {
        // ВАШ РОБОЧИЙ АКАУНТ (СВІЖІ ДАНІ)
        id: '12137273349',
        username: 'melanymusillo_acc', // Ім'я для логів
        // Ваші свіжі куки з попереднього кроку
        cookie: 'csrftoken=1a3uEzakx-3LiE5qfIQ-YN; datr=hn4vaVNq7MvdM94ZbdvOhbZb; ig_did=56C6F218-D328-43A3-9264-89695460572B; wd=1920x179; mid=aS9-hgALAAF9yrgaqeWgw5Y-Dwot; sessionid=12137273349%3AIcqM72BpZRoq3J%3A4%3AAYiNZ8KVovyAqQQAmYBFYjjHwq1wZDmj9rpSenHkmw; ds_user_id=12137273349; rur="RVA\\05412137273349\\0541796257258:01fe410223a58fa7e457d83584afc520f3f9e3c703f2d801efba0bc86084552917333abb"',
        csrftoken: '1a3uEzakx-3LiE5qfIQ-YN',
        lsd: 'B-2Of-xMV_X3_Sv3LeBr4M' // Додав LSD
    }
    // Можна додати інші акаунти сюди за тим же шаблоном
];

let currentAccIndex = 0;

const rotateAccount = () => {
    const oldIndex = currentAccIndex;
    currentAccIndex = (currentAccIndex + 1) % ACC_POOL.length;
    console.log(`🔄 [ROTATION] Switching account: #${oldIndex + 1} -> #${currentAccIndex + 1} (${ACC_POOL[currentAccIndex].id})`);
};

const getAuthHeaders = () => {
    const acc = ACC_POOL[currentAccIndex];
    return {
        'accept': '*/*',
        'accept-language': 'uk-UA,uk;q=0.8,en-US;q=0.5,en;q=0.3',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': acc.cookie,
        'dnt': '1',
        'origin': 'https://www.instagram.com',
        'priority': 'u=1, i',
        'sec-ch-prefers-color-scheme': 'dark',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        // Використовуємо User-Agent для Windows/Firefox як у вас
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
        'x-asbd-id': '359341',
        'x-csrftoken': acc.csrftoken,
        'x-fb-lsd': acc.lsd || 'B-2Of-xMV_X3_Sv3LeBr4M', // Фолбек якщо немає в об'єкті
        'x-ig-app-id': '936619743392459',
    };
};

const getCurrentAccId = () => ACC_POOL[currentAccIndex].id;

// ==========================================
// 🛡️ SYSTEM INIT
// ==========================================

process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL ERROR (Uncaught):', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 CRITICAL ERROR (Unhandled Rejection):', reason);
});

if (!token) {
    console.error('❌ ПОМИЛКА: TELEGRAM_BOT_TOKEN не встановлено!');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const limit = pLimit(CONCURRENCY_LIMIT);

console.log('✅ pLimit initialized:', typeof limit === 'function');

const userStates = new Map();
let authorizedUsers = [];
let reelsDb = {}; 

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// ==========================================
// 🔐 СИСТЕМА ДОСТУПУ ТА БД
// ==========================================

const loadUsers = async () => {
    try {
        if (DATA_DIR !== '.') {
            try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
        }
        
        try {
            const data = await fs.readFile(USERS_FILE, 'utf-8');
            authorizedUsers = JSON.parse(data);
        } catch { authorizedUsers = []; await saveUsers(); }

        try {
            const rData = await fs.readFile(REELS_DB_FILE, 'utf-8');
            reelsDb = JSON.parse(rData);
        } catch { 
            reelsDb = {}; 
            await saveReelsDb(); 
        }

        console.log(`✅ [SYSTEM] DB Loaded. Users: ${authorizedUsers.length}, Reels Trackers: ${Object.keys(reelsDb).length}`);
    } catch (error) {
        console.error('❌ Error loading DB:', error);
    }
};

const saveUsers = async () => {
    try { await fs.writeFile(USERS_FILE, JSON.stringify(authorizedUsers, null, 2)); } catch (e) {}
};

const saveReelsDb = async () => {
    try { await fs.writeFile(REELS_DB_FILE, JSON.stringify(reelsDb, null, 2)); } catch (e) {}
};

const hasAccess = (userId) => {
    return ADMIN_IDS.includes(userId) || authorizedUsers.some(u => u.id === userId);
};

const isAdmin = (userId) => {
    return ADMIN_IDS.includes(userId);
};

loadUsers();

// ==========================================
// 📋 МЕНЮ
// ==========================================

const setupBotMenu = async () => {
    try {
        await bot.setMyCommands([
            { command: 'start', description: '🚀 Почати роботу' },
            { command: 'admin', description: '🛡️ Адмін-панель' },
            { command: 'tracker', description: '📹 Трекер Reels' },
            { command: 'help', description: '📚 Гайд' }
        ]);
        console.log('✅ [SYSTEM] Меню команд встановлено.');
    } catch (err) {
        console.error('❌ Помилка встановлення меню:', err.message);
    }
};

setupBotMenu();

// ==========================================
// 🛠 УТИЛІТИ
// ==========================================

const formatNumber = (num) => {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return num.toString();
};

const extractEmail = (text) => {
    if (!text) return null;
    const match = text.match(EMAIL_REGEX);
    return match ? match[0] : null;
};

const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

const getProgressBar = (current, total) => {
    const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const filledLength = Math.round((percentage / 10));
    const emptyLength = 10 - filledLength;
    const filled = '█'.repeat(filledLength);
    const empty = '▒'.repeat(emptyLength);
    return `❪${filled}${empty}❫ ${percentage}%`;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1) + min));

// ==========================================
// 📡 INSTAGRAM API (COMMON)
// ==========================================

// ✅ ОНОВЛЕНО: Стабільний REST API метод
const getUserById = async (id, attempt = 0) => {
    try {
        const response = await axios.get(
            `https://www.instagram.com/api/v1/users/${id}/info/`,
            { 
                headers: getAuthHeaders() 
            }
        );

        if (!response.data || !response.data.user) {
            // console.log(`Debug Info for ${id}:`, response.data);
            throw new Error('User not found in response');
        }

        return response.data.user;

    } catch (e) {
        // Ігноруємо 404 (юзер не знайдений/видалений)
        if (e.response && e.response.status === 404) {
            return null;
        }

        if (attempt < ACC_POOL.length - 1) { // -1 бо у нас поки один робочий акк
            console.log(`⚠️ getUserById failed for ${id} (Status: ${e.response?.status}), rotating...`);
            rotateAccount();
            return getUserById(id, attempt + 1);
        }
        
        return null; // Просто пропускаємо проблемного юзера
    }
}

const getUserIdFromUsername = async (username, attempt = 0) => {
    try {
        const generateSearchSessionId = () => {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        };

        // Замінив fb_dtsg на значення з вашого логу, хоча воно швидко змінюється
        // Зазвичай для пошуку це не критично, але для надійності
        const body = {
            av: getCurrentAccId(),
            __d: 'www',
            __user: getCurrentAccId(),
            __a: '1',
            __req: '16',
            __hs: '20396.HCSV2:instagram_web_pkg.2.1...0',
            dpr: '2',
            __ccg: 'GOOD',
            __rev: '1029375730',
            fb_dtsg: 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021', 
            lsd: ACC_POOL[currentAccIndex].lsd,
            jazoest: '26173',
            __comet_req: '7',
            server_timestamps: 'true',
            doc_id: '24146980661639222',
            variables: JSON.stringify({
                data: {
                    context: 'blended',
                    include_reel: 'true',
                    query: username,
                    rank_token: '',
                    search_session_id: generateSearchSessionId(),
                    search_surface: 'web_top_search'
                },
                hasQuery: true
            })
        };

        const response = await axios.post(
            'https://www.instagram.com/graphql/query',
            new URLSearchParams(body).toString(),
            {
                headers: {
                    ...getAuthHeaders(),
                    'referer': `https://www.instagram.com/`,
                    'x-fb-friendly-name': 'PolarisSearchBoxRefetchableQuery',
                    'x-root-field-name': 'xdt_api__v1__fbsearch__topsearch_connection'
                }
            }
        );

        const searchResults = response.data?.data?.xdt_api__v1__fbsearch__topsearch_connection?.users || [];
        if (searchResults.length === 0) {
            throw new Error(`User with username "${username}" not found`);
        }

        const result = searchResults.find(u => u.user?.username?.toLowerCase() === username.toLowerCase());
        if (!result) {
            // Fallback: беремо першого, якщо точного збігу немає
            return searchResults[0].user.id;
        }

        return result.user.id;

    } catch (e) {
        if (attempt < ACC_POOL.length - 1) {
            rotateAccount();
            return getUserIdFromUsername(username, attempt + 1);
        }
        throw e;
    }
}

const getAllFollowers = async (id, limitAmount, attempt = 0, onProgress = null) => {
    let next_max_id = null;
    let hasMore = true;
    const ids = [];

    while (hasMore) {
        if (ids.length >= limitAmount) break;

        try {
            const response = await axios.get(
                `https://www.instagram.com/api/v1/friendships/${id}/followers/?count=200${next_max_id ? `&max_id=${next_max_id}` : ''}`,
                {
                    headers: {
                        ...getAuthHeaders(),
                        'referer': `https://www.instagram.com/${id}/followers/`,
                        'x-web-session-id': '8qqznb:7gjo7n:hmve9m'
                    }
                }
            );

            const newIds = response.data.users.map(item => item.id);
            ids.push(...newIds);
            
            if(onProgress) onProgress(ids.length);

            hasMore = response.data.has_more;
            next_max_id = response.data.next_max_id;
            await randomSleep(1000, 2000); // Збільшив затримку для безпеки
        } catch (e) {
            console.error(`Error getting followers: ${e.message}`);
            hasMore = false;
        }
    }

    return ids.slice(0, limitAmount);
}

const getAllFollowing = async (id, limitAmount, attempt = 0, onProgress = null) => {
    let next_max_id = null;
    let hasMore = true;
    const ids = [];

    while (hasMore) {
        if (ids.length >= limitAmount) break;

        try {
            const response = await axios.get(
                `https://www.instagram.com/api/v1/friendships/${id}/following/?count=200${next_max_id ? `&max_id=${next_max_id}` : ''}`,
                {
                    headers: {
                        ...getAuthHeaders(),
                        'referer': `https://www.instagram.com/${id}/following/`,
                        'x-web-session-id': '8qqznb:7gjo7n:hmve9m'
                    }
                }
            );

            const newIds = response.data.users.map(item => item.id);
            ids.push(...newIds);

            if(onProgress) onProgress(ids.length);

            hasMore = response.data.has_more;
            next_max_id = response.data.next_max_id;
            await randomSleep(1000, 2000);
        } catch (e) {
            console.error(`Error getting following: ${e.message}`);
            hasMore = false;
        }
    }

    return ids.slice(0, limitAmount);
}

const getUsersByHashtag = async (tag, limitAmount, attempt = 0, onProgress = null) => {
    let next_max_id = null;
    let hasMore = true;
    const userIds = new Set();
    const cleanTag = encodeURIComponent(tag.replace('#', ''));
    let currentTab = 'recent'; 

    console.log(`🔎 Пошук по хештегу: #${decodeURIComponent(cleanTag)}`);

    while (hasMore && userIds.size < limitAmount) {
        try {
            const body = new URLSearchParams({
                surface: 'grid',
                tab: currentTab, 
                user_id: getCurrentAccId(),
                include_persistent: 0,
                ...(next_max_id && { max_id: next_max_id })
            });

            const response = await axios.post(
                `https://www.instagram.com/api/v1/tags/${cleanTag}/sections/`,
                body.toString(),
                {
                    headers: {
                        ...getAuthHeaders(),
                        'referer': `https://www.instagram.com/explore/tags/${cleanTag}/`,
                        'x-instagram-ajax': '1',
                        'x-requested-with': 'XMLHttpRequest',
                        'x-web-session-id': '8qqznb:7gjo7n:hmve9m'
                    }
                }
            );

            const sections = response.data.sections || [];
            
            if (sections.length === 0 && currentTab === 'recent' && !next_max_id) {
                console.log('⚠️ Вкладка "Недавні" порожня або прихована. Перемикаюся на "Топ" (Popular)...');
                currentTab = 'top';
                continue; 
            }

            for (const section of sections) {
                if (section.layout_content && section.layout_content.medias) {
                    for (const mediaWrapper of section.layout_content.medias) {
                        const user = mediaWrapper.media?.user;
                        if (user && user.pk) {
                            userIds.add(user.pk);
                        }
                    }
                }
            }

            if(onProgress) onProgress(userIds.size);

            if (userIds.size >= limitAmount) break;

            hasMore = response.data.more_available;
            next_max_id = response.data.next_max_id;
            await randomSleep(1500, 3000); 

        } catch (e) {
            console.error(`❌ Помилка парсингу хештегу ${tag}:`, e.message);
            hasMore = false; 
            break;
        }
    }

    return Array.from(userIds).slice(0, limitAmount);
};

const getReels = async (userId, { after = null, first = 7, pageSize = 2 } = {}, attempt = 0) => {
    try {
        const body = {
            av: getCurrentAccId(),
            __d: 'www',
            __user: getCurrentAccId(),
            __a: '1',
            __req: '3a',
            __hs: '20402.HCSV2:instagram_web_pkg.2.1...0',
            dpr: '2',
            __ccg: 'GOOD',
            __rev: '1029645341',
            fb_dtsg: 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021',
            lsd: ACC_POOL[currentAccIndex].lsd,
            jazoest: '26265',
            doc_id: '9905035666198614',
            variables: JSON.stringify({
                after: after,
                before: null,
                data: {
                    include_feed_video: true,
                    page_size: pageSize,
                    target_user_id: userId
                },
                first: first,
                last: null
            })
        };

        const response = await axios.post(
            'https://www.instagram.com/graphql/query',
            new URLSearchParams(body).toString(),
            {
                headers: {
                    ...getAuthHeaders(),
                    'referer': `https://www.instagram.com/`,
                    'x-fb-friendly-name': 'PolarisProfileReelsTabContentQuery_connection',
                    'x-root-field-name': 'xdt_api__v1__clips__user__connection_v2'
                }
            }
        );

        const edges = response.data?.data?.xdt_api__v1__clips__user__connection_v2?.edges;

        if (!edges) return [];

        return edges.reduce((acc, edge) => {
            const media = edge.node.media;
            if (media.clips_tab_pinned_user_ids && media.clips_tab_pinned_user_ids.length) {
                return acc;
            }

            acc.push(media.play_count);
            return acc;
        }, []).slice(0, 7);

    } catch (e) {
        return [];
    }
}

const getPosts = async (username, { count = 12, includeReelMediaSeenTimestamp = true, includeRelationshipInfo = true, latestBestiesReelMedia = true, latestReelMedia = true } = {}, attempt = 0) => {
    try {
        const body = {
            av: getCurrentAccId(),
            __d: 'www',
            __user: getCurrentAccId(),
            __a: '1',
            __req: '6',
            __hs: '20402.HCSV2:instagram_web_pkg.2.1...0',
            dpr: '2',
            __ccg: 'MODERATE',
            __rev: '1029645341',
            fb_dtsg: 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021',
            lsd: ACC_POOL[currentAccIndex].lsd,
            jazoest: '26525',
            doc_id: '24937007899300943',
            variables: JSON.stringify({
                data: {
                    count: count,
                    include_reel_media_seen_timestamp: includeReelMediaSeenTimestamp,
                    include_relationship_info: includeRelationshipInfo,
                    latest_besties_reel_media: latestBestiesReelMedia,
                    latest_reel_media: latestReelMedia
                },
                username: username,
                __relay_internal__pv__PolarisIsLoggedInrelayprovider: true
            })
        };

        const response = await axios.post(
            'https://www.instagram.com/graphql/query',
            new URLSearchParams(body).toString(),
            {
                headers: {
                    ...getAuthHeaders(),
                    'referer': `https://www.instagram.com/${username}/`,
                    'x-fb-friendly-name': 'PolarisProfilePostsQuery',
                    'x-root-field-name': 'xdt_api__v1__feed__user_timeline_graphql_connection'
                }
            }
        );

        const edges = response.data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
        if (!edges) return '';
        return edges.map((edge) => edge.node.caption?.text || '').filter(Boolean).join(', ');
    } catch (e) {
        return '';
    }
}

// ==========================================
// 📊 PROCESSING & MAPPING
// ==========================================

const mapFollowers = async ({ ids, limit: limitAmount, min, max }, progressCallback) => {
    const results = [];
    let processed = 0;

    console.log(`🔄 Starting to process ${Math.min(ids.length, limitAmount)} users with concurrency: ${CONCURRENCY_LIMIT}`);

    // Нормальна обробка з pLimit
    const promises = ids.slice(0, limitAmount).map(id => 
        limit(async () => {
            try {
                // Додаємо випадкову затримку перед кожним потоком, щоб вони не били в сервер одночасно
                await randomSleep(100, 2000);

                const user = await getUserById(id);
                if (!user) {
                    processed++;
                    if (progressCallback) progressCallback(processed, Math.min(ids.length, limitAmount), 'Skipped');
                    return null;
                }

                const followerCount = user.follower_count || 0;
                const isPrivate = user.is_private || false;

                if (followerCount < min || followerCount > max || isPrivate) {
                    processed++;
                    if (progressCallback) progressCallback(processed, Math.min(ids.length, limitAmount), 'Skipped');
                    return null;
                }

                const username = user.username || 'N/A';
                const fullName = user.full_name || 'N/A';
                const biography = user.biography || '';

                await randomSleep(500, 1000); 
                const reelsViews = await getReels(id);
                const avgReelsViews = reelsViews.length > 0 
                    ? Math.round(reelsViews.reduce((a, b) => a + b, 0) / reelsViews.length) 
                    : 0;

                const postsText = await getPosts(username);
                const email = extractEmail(postsText) || extractEmail(biography);

                const result = {
                    username,
                    fullName,
                    followers: followerCount,
                    avgReelsViews,
                    rawAverage: avgReelsViews,
                    email,
                    language: detectAll(biography || postsText)[0]?.lang || 'uk',
                    profile_pic_url: user.profile_pic_url || null
                };

                results.push(result);
                processed++;
                
                if (progressCallback) {
                    progressCallback(processed, Math.min(ids.length, limitAmount), username);
                }

                await randomSleep(800, 1500);
                return result;
                
            } catch (e) {
                console.error(`❌ Error processing user ${id}:`, e.message);
                processed++; 
                return null;
            }
        })
    );

    await Promise.all(promises);
    return results.filter(Boolean);
};

const saveToXlsx = async (data, username) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Results');

        // Set column headers according to your desired structure
        worksheet.columns = [
            { header: 'Profile Picture', key: 'profile_pic', width: 15 },
            { header: 'Username', key: 'username', width: 20 },
            { header: 'URL', key: 'url', width: 50 },
            { header: 'Full Name', key: 'full_name', width: 30 },
            { header: 'Follower Count', key: 'follower_count', width: 15 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Average', key: 'average', width: 15 },
            { header: 'Languages', key: 'languages', width: 30 }
        ];

        // Set row height for image rows
        worksheet.getRow(1).height = 100;

        // Add data rows
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const row = worksheet.addRow({
                username: item.username || '',
                url: `https://www.instagram.com/${item.username}/`,
                full_name: item.fullName || '',
                follower_count: formatNumber(item.followers) || 0,
                email: item.email || '',
                average: formatNumber(item.avgReelsViews) || '',
                languages: item.language || ''
            });

            // Set row height for image rows
            row.height = 100;

            // Download and add profile picture if available
            if (item.profile_pic_url) {
                try {
                    const imageResponse = await axios.get(item.profile_pic_url, {
                        responseType: 'arraybuffer',
                        timeout: 10000
                    });
                    const imageBuffer = Buffer.from(imageResponse.data);
                    
                    // Determine image extension
                    let imageExtension = 'jpeg';
                    const contentType = imageResponse.headers['content-type'];
                    if (contentType?.includes('png')) {
                        imageExtension = 'png';
                    } else if (contentType?.includes('gif')) {
                        imageExtension = 'gif';
                    } else if (contentType?.includes('webp')) {
                        imageExtension = 'webp';
                    }

                    // Add image to workbook
                    const imageId = workbook.addImage({
                        buffer: imageBuffer,
                        extension: imageExtension,
                    });

                    // Insert image into cell
                    worksheet.addImage(imageId, {
                        tl: { col: 0, row: i + 1 },
                        br: { col: 1, row: i + 2 },
                        editAs: 'oneCell'
                    });
                } catch (error) {
                    console.log(`❌ Failed to load image for ${item.username}: ${error.message}`);
                }
            }
        }

        // Save with username as filename
        const safeFilename = `${username}.xlsx`.replace(/[^a-zA-Z0-9._-]/g, '_');
        await workbook.xlsx.writeFile(safeFilename);
        console.log(`✅ Saved ${data.length} results to ${safeFilename}`);
        return safeFilename;
    } catch (error) {
        console.error('❌ Error saving XLSX:', error);
        return null;
    }
};

// ==========================================
// 📹 REELS TRACKER: ОНОВЛЕНА ВЕРСІЯ
// ==========================================

const getReelMetricsWithLikes = async (url, attempt = 0) => {
    try {
        const match = url.match(/\/reel\/([^/?]+)/);
        if (!match) {
            console.log(`❌ Invalid Reels URL: ${url}`);
            return null;
        }
        
        const shortcode = match[1];
        console.log(`🔍 Fetching metrics for reel: ${shortcode}`);

        // GraphQL метод (без cookies)
        try {
            const graphqlUrl = new URL(`https://www.instagram.com/api/graphql`);
            graphqlUrl.searchParams.set("variables", JSON.stringify({ shortcode: shortcode }));
            graphqlUrl.searchParams.set("doc_id", "10015901848480474");
            graphqlUrl.searchParams.set("lsd", "AVqbxe3J_YA"); 

            const response = await axios.post(graphqlUrl.toString(), null, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-IG-App-ID": "936619743392459",
                    "X-FB-LSD": "AVqbxe3J_YA",
                    "X-ASBD-ID": "129477",
                    "Sec-Fetch-Site": "same-origin",
                    "Accept": "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Origin": "https://www.instagram.com",
                    "Referer": `https://www.instagram.com/reel/${shortcode}/`,
                    "X-Requested-With": "XMLHttpRequest"
                },
                timeout: 15000
            });

            const mediaData = response.data?.data?.xdt_shortcode_media;
            
            if (mediaData) {
                const result = {
                    views: mediaData.video_view_count || mediaData.video_play_count || 0,
                    likes: mediaData.edge_media_preview_like?.count || 0,
                    comments: mediaData.edge_media_to_parent_comment?.count || 0
                };

                if (result.views > 0) {
                    console.log(`✅ Reel ${shortcode}: ${result.views} views, ${result.likes} likes, ${result.comments} comments (GraphQL)`);
                    return result;
                }
            }

        } catch (graphqlError) {
            console.log(`⚠️ GraphQL method failed: ${graphqlError.message}`);
            
            // Спроба альтернативного doc_id
            if (attempt === 0) {
                console.log('🔄 Trying alternative GraphQL query...');
                return getReelMetricsWithLikes(url, 1);
            }
        }

        // Альтернативний GraphQL метод
        try {
            const graphqlUrl2 = new URL(`https://www.instagram.com/api/graphql`);
            graphqlUrl2.searchParams.set("variables", JSON.stringify({ 
                shortcode: shortcode,
                fetch_comment_count: false,
                fetch_related_profile_media_count: false,
                has_threaded_comments: false
            }));
            graphqlUrl2.searchParams.set("doc_id", "10015901848480474");
            graphqlUrl2.searchParams.set("lsd", "AVqbxe3J_YA");

            const response2 = await axios.post(graphqlUrl2.toString(), null, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-IG-App-ID": "936619743392459",
                    "X-FB-LSD": "AVqbxe3J_YA",
                    "X-ASBD-ID": "129477",
                    "Sec-Fetch-Site": "same-origin",
                    "Referer": `https://www.instagram.com/reel/${shortcode}/`,
                },
                timeout: 15000
            });

            const mediaData2 = response2.data?.data?.xdt_shortcode_media;
            
            if (mediaData2) {
                const result = {
                    views: mediaData2.video_view_count || mediaData2.video_play_count || 0,
                    likes: mediaData2.edge_media_preview_like?.count || 0,
                    comments: mediaData2.edge_media_to_parent_comment?.count || 0
                };

                if (result.views > 0) {
                    console.log(`✅ Reel ${shortcode}: ${result.views} views (GraphQL Alt)`);
                    return result;
                }
            }

        } catch (graphqlError2) {
            console.log(`⚠️ Alternative GraphQL failed: ${graphqlError2.message}`);
        }

        // Резервний метод через Magic Parameters (з cookies)
        try {
            const response3 = await axios.get(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
                headers: {
                    ...getAuthHeaders(),
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "X-IG-App-ID": "936619743392459",
                    "Sec-Fetch-Site": "same-origin"
                },
                timeout: 15000
            });

            const items = response3.data?.items?.[0];
            if (items) {
                const result = {
                    views: items.view_count || items.play_count || 0,
                    likes: items.like_count || 0,
                    comments: items.comment_count || 0
                };

                if (result.views > 0) {
                    console.log(`✅ Reel ${shortcode}: ${result.views} views (Magic Params)`);
                    return result;
                }
            }

        } catch (magicError) {
            console.log(`⚠️ Magic Parameters failed: ${magicError.message}`);
        }

        console.log(`❌ All methods failed for: ${shortcode}`);
        return { views: 0, likes: 0, comments: 0 };

    } catch (e) {
        console.error(`[Reels Error] ${url}: ${e.message}`);
        
        if (attempt < 2) {
            await sleep(3000);
            return getReelMetricsWithLikes(url, attempt + 1);
        }
        
        return { views: 0, likes: 0, comments: 0 };
    }
};

// ==========================================
// 📹 REELS TRACKER: SEND EXCEL REPORT
// ==========================================

const sendTrackerReport = async (chatId) => {
    const userData = reelsDb[chatId];
    if (!userData || !userData.length) {
        await bot.sendMessage(chatId, '📭 Ваш список відстеження порожній.');
        return;
    }

    const progressMsg = await bot.sendMessage(chatId, `⏳ Збираю дані по ${userData.length} відео...`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reels Analytics');

    worksheet.columns = [
        { header: 'Дата', key: 'date', width: 12 },
        { header: 'URL', key: 'url', width: 40 },
        { header: 'Перегляди', key: 'views', width: 15 },
        { header: 'Лайки', key: 'likes', width: 12 },
        { header: 'Коментарі', key: 'comments', width: 12 },
        { header: 'Статус', key: 'status', width: 15 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6E6FA' }
    };

    const today = new Date().toLocaleDateString('uk-UA');
    let successCount = 0;

    for (let i = 0; i < userData.length; i++) {
        const url = userData[i];
        try {
            await bot.editMessageText(`⏳ Обробляю ${i + 1}/${userData.length}...`, {
                chat_id: chatId,
                message_id: progressMsg.message_id
            });

            let metricsArr = await getReelMetricsWithLikes(url);
            let viewsArr = [];
            if (Array.isArray(metricsArr)) {
                viewsArr = metricsArr.map(m => m.views || 0).filter(v => typeof v === 'number');
            } else if (metricsArr && typeof metricsArr.views === 'number') {
                viewsArr = [metricsArr.views];
            } else {
                viewsArr = [0];
            }
            const totalViews = viewsArr.reduce((a, b) => a + b, 0);

            let status = 'Успішно';
            if (totalViews === 0) {
                status = 'Немає даних';
            }

            worksheet.addRow({
                date: today,
                url: url,
                views: totalViews,
                likes: (metricsArr.likes || 0),
                comments: (metricsArr.comments || 0),
                status: status
            });

            if (totalViews > 0) {
                successCount++;
            }

            await sleep(2000);

        } catch (error) {
            console.error(`Error processing ${url}:`, error.message);
            worksheet.addRow({
                date: today,
                url: url,
                views: 0,
                likes: 0,
                comments: 0,
                status: 'Помилка'
            });
        }
    }

    await bot.deleteMessage(chatId, progressMsg.message_id);

    try {
        worksheet.addRow({});
        const statsRow = worksheet.addRow({
            date: 'СТАТИСТИКА',
            url: `Успішно: ${successCount}/${userData.length}`,
            views: `Дата: ${today}`,
            likes: 'GraphQL метод',
            comments: '',
            status: ''
        });
        statsRow.font = { bold: true, color: { argb: 'FF0000FF' } };

        const filename = `reels_tracker_${chatId}_${Date.now()}.xlsx`;
        await workbook.xlsx.writeFile(filename);
        
        const fileBuffer = await fs.readFile(filename);
        
        await bot.sendDocument(chatId, fileBuffer, {}, {
            filename: `Reels_Analytics_${today.replace(/\//g, '-')}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await fs.unlink(filename);

        await bot.sendMessage(chatId, 
            `📊 **Звіт сформовано!**\n\n` +
            `✅ Отримано дані: ${successCount}/${userData.length} відео\n` +
            `📅 Дата: ${today}\n` +
            `🔄 Використано: GraphQL метод (без cookies)\n` +
            `📁 Файл містить: URL, перегляди, лайки, коментарі`
        );

    } catch (error) {
        console.error('Error sending file:', error);
        await bot.sendMessage(chatId, '❌ Помилка при створенні файлу.');
    }
};

// ==========================================
// 🚀 ОСНОВНИЙ ПРОЦЕС
// ==========================================

async function startScrapingProcess(chatId, config, overrideInput) {
    let currentInput = overrideInput || config.usernames[0];
    let msgId = (await bot.sendMessage(chatId, `🛰 *Ініціалізація...*`, { parse_mode: 'Markdown' })).message_id;

    try {
        for (let i = 0; i < config.usernames.length; i++) {
            const safeInput = escapeHtml(currentInput);

            try {
                const typeLabel = config.parseType === 'hashtag' ? 'Хештег' : 
                                 (config.parseType === 'followers' ? 'Підписники' : 'Підписки');

                await bot.editMessageText(
                    `📡 <b>SAMIParser Active</b>\n` +
                    `━━━━━━━━━━━━\n` +
                    `📂 Джерело [${i + 1}/${config.usernames.length}]: <code>${safeInput}</code>\n` +
                    `🏷 Тип: ${typeLabel}\n` +
                    `⏳ Отримую дані...`,
                    { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
                );

                let lastFetchUpdate = 0;
                const fetchProgressCallback = async (count) => {
                    const now = Date.now();
                    if (now - lastFetchUpdate > 2000) { 
                        try {
                            await bot.editMessageText(
                                `📡 <b>SAMIParser Active</b>\n` +
                                `━━━━━━━━━━━━\n` +
                                `📂 Джерело: <code>${safeInput}</code>\n` +
                                `🏷 Тип: ${typeLabel}\n` +
                                `📥 Завантажено ID: <b>${count}</b> ⏳\n` +
                                `━━━━━━━━━━━━`,
                                { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
                            );
                            lastFetchUpdate = now;
                        } catch(e) {}
                    }
                };

                let allIds = [];

                if (config.parseType === 'hashtag') {
                    allIds = await getUsersByHashtag(currentInput, config.limit, 0, fetchProgressCallback);
                } else {
                    const targetId = await getUserIdFromUsername(currentInput);
                    if (config.parseType === 'followers') {
                        allIds = await getAllFollowers(targetId, config.limit, 0, fetchProgressCallback);
                    } else {
                        allIds = await getAllFollowing(targetId, config.limit, 0, fetchProgressCallback);
                    }
                }

                if (allIds.length === 0) {
                    await bot.sendMessage(chatId, `⚠️ Помилка з <code>${safeInput}</code>: Не вдалося отримати дані (0 результатів).`, { parse_mode: 'HTML' });
                    continue;
                }

                const toCheck = Math.min(allIds.length, config.limit);

                await bot.editMessageText(
                    `📡 <b>SAMIParser Active</b>\n` +
                    `━━━━━━━━━━━━\n` +
                    `📂 Джерело: <code>${safeInput}</code>\n` +
                    `🏷 Тип: ${typeLabel}\n` +
                    `🔢 Знайдено: ${allIds.length}\n` +
                    `🎯 Ціль: ${toCheck} перевірок\n` +
                    `🚀 <i>Запуск двигунів...</i>`,
                    { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
                );

                let lastUpdate = Date.now();
                const progressCallback = async (current, total, activeUser) => {
                    const now = Date.now();
                    if (now - lastUpdate > 2500 || current === total) {
                        try {
                            const safeActiveUser = escapeHtml(activeUser);
                            await bot.editMessageText(
                                `📡 <b>SAMIParser Active</b>\n` +
                                `━━━━━━━━━━━━\n` +
                                `📂 Джерело: <code>${safeInput}</code>\n` +
                                `🏷 Тип: ${typeLabel}\n` +
                                `👤 Аналіз: <code>${safeActiveUser}</code>\n` +
                                `${getProgressBar(current, total)}\n` +
                                `🔢 Оброблено: ${current}/${total}\n` +
                                `━━━━━━━━━━━━`,
                                { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
                            );
                            lastUpdate = now;
                        } catch (e) { }
                    }
                };

                const accountResults = await mapFollowers({
                    ids: allIds, limit: toCheck, min: config.min, max: config.max
                }, progressCallback);

                accountResults.sort((a, b) => b.rawAverage - a.rawAverage);

                if (accountResults.length === 0) {
                    await bot.sendMessage(chatId,
                        `❌ По <code>${safeInput}</code> нічого не знайдено (0 лідів).`,
                        { parse_mode: 'HTML' }
                    );
                } else {
                    await bot.editMessageText(
                        `💾 <b>Формую звіт для ${safeInput}...</b>\n` +
                        `Всього: ${accountResults.length}`,
                        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
                    );

                    const filename = await saveToXlsx(accountResults, currentInput);

                    if (filename) {
                        const fileBuffer = await fs.readFile(filename);
                        await bot.sendDocument(chatId, fileBuffer, {}, {
                            filename: filename,
                            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        });

                        await fs.unlink(filename);
                    }
                }

            } catch (accError) {
                const errorMsg = escapeHtml(accError.message);
                const safeErrInput = escapeHtml(currentInput);
                
                await bot.sendMessage(chatId,
                    `⚠️ <b>Помилка з ${safeErrInput}:</b>\n<pre>${errorMsg}</pre>\n` +
                    `Переходжу до наступного...`,
                    { parse_mode: 'HTML' }
                );
            }
        }

        await bot.editMessageText(`✅ <b>Всі завдання виконано!</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });

    } catch (e) {
        const errText = `❌ <b>Глобальний збій:</b> <pre>${escapeHtml(e.message)}</pre>`;
        if (msgId) await bot.editMessageText(errText, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });
        else await bot.sendMessage(chatId, errText, { parse_mode: 'HTML' });
    }
}

// ==========================================
// 🤖 TELEGRAM BOT INTERFACE
// ==========================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    const customKeyboard = {
        keyboard: [
            ['👥 Парсинг підписників', '📋 Парсинг підписок'],
            ['#️⃣ Пошук по хештегу', '📹 Трекер Reels'], 
            ['🛡️ Адмін-панель', '📚 Довідка'],
            ['🆔 Мій ID']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };

    if (hasAccess(chatId)) {
        bot.sendMessage(chatId,
            `👋 *Привіт! SAMIParser активний.*\n\n` +
            `_Оберіть дію з меню нижче:_`,
            {
                parse_mode: 'Markdown',
                reply_markup: customKeyboard
            }
        );
    } else {
        bot.sendMessage(chatId,
            `🔒 *Доступ обмежено*\n\n` +
            `Цей бот є приватним. Надішліть запит адміністратору.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔑 Надіслати запит на доступ', callback_data: 'request_access' }]
                    ]
                }
            }
        );
    }
});

bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;

    if (authorizedUsers.length === 0) {
        return bot.sendMessage(chatId, '📂 Список користувачів порожній.');
    }

    const userButtons = authorizedUsers.map(user => ([
        { text: `${user.name || 'User'} (${user.id})`, callback_data: 'dummy' },
        { text: '❌ Видалити', callback_data: `delete_user_${user.id}` }
    ]));

    userButtons.unshift([{ text: 'ℹ️ Як видаляти?', callback_data: 'admin_help' }]);

    bot.sendMessage(chatId, `🛡 *Адмін-Панель* (${authorizedUsers.length}):`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: userButtons }
    });
});

bot.onText(/\/id/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `🆔 <b>Ваш Chat ID:</b>\n<code>${chatId}</code>\n\n` +
        `<i>Скопіюйте цей ID, якщо потрібно додати вас до бота.</i>`,
        { parse_mode: 'HTML' }
    );
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `📚 <b>Гайд SAMIParser</b>\n\n` +
        `<b>Як користуватися:</b>\n` +
        `1️⃣ Натисніть /start щоб почати\n` +
        `2️⃣ Оберіть тип парсингу (підписники, підписки або хештег)\n` +
        `3️⃣ Введіть нікнейми або хештеги через кому\n` +
        `4️⃣ Вкажіть мінімальну кількість підписників\n` +
        `5️⃣ Бот надішле файл з результатами\n\n` +
        `<b>📹 Трекер Reels:</b>\n` +
        `1️⃣ Натисни "📹 Трекер Reels"\n` +
        `2️⃣ Додай посилання на відео\n` +
        `3️⃣ Натисни "Оновити та скачати Excel"\n\n` +
        `<b>Доступні команди:</b>\n` +
        ` /start - Почати роботу\n` +
        ` /help - Цей гайд\n` +
        ` /id - Показати ваш Chat ID\n` +
        ` /admin - Адмін-панель\n\n` +
        `<b>Потрібна допомога?</b>\n` +
        `Напишіть адміністратору.`,
        { parse_mode: 'HTML' }
    );
});

function handleParsingSteps(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    if (!hasAccess(chatId)) return;

    const state = userStates.get(chatId);
    if (!state) return;

    try {
        switch (state.step) {
            case 'usernames':
                let sources = text.split(',').map(u => u.trim().replace('@', '')).filter(Boolean);
                if (sources.length === 0) return bot.sendMessage(chatId, '⚠️ Введіть хоча б один нік або хештег.');

                state.usernames = sources;
                state.step = 'min_followers';

                let typeText = '';
                if (state.parseType === 'followers') typeText = 'підписників';
                else if (state.parseType === 'following') typeText = 'підписок';
                else typeText = 'хештегів';

                bot.sendMessage(chatId,
                    `✅ Прийнято: **${sources.length}** джерел.\n` +
                    `📊 Тип: **${typeText}**\n\n` +
                    `✍️ *Крок 2/2*\n` +
                    `Вкажіть **мінімальну** кількість підписників для знайдених юзерів (напр. 1000):`,
                                     { parse_mode: 'Markdown' });
                break;

            case 'min_followers':
                const min = parseInt(text);
                if (isNaN(min)) return bot.sendMessage(chatId, '❌ Це має бути число.');

                state.min = min;
                state.max = DEFAULT_MAX_FOLLOWERS;
                state.limit = DEFAULT_LIMIT;

                userStates.delete(chatId);

                // Multi-hashtag support
                if (state.parseType === 'hashtag') {
                    (async () => {
                        for (const hashtag of state.usernames) {
                            let config = {
                                ...state,
                                parseType: 'hashtag',
                                min: state.min,
                                max: state.max,
                                limit: state.limit
                            };
                            await startScrapingProcess(chatId, config, hashtag);
                        }
                        await bot.sendMessage(chatId, '✅ <b>Всі хештеги оброблено!</b>', { parse_mode: 'HTML' });
                    })();
                } else {
                    startScrapingProcess(chatId, state);
                }
                break;
        }
    } catch (error) {
        bot.sendMessage(chatId, `⚠️ Помилка: ${error.message}`);
        userStates.delete(chatId);
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    if (!hasAccess(chatId)) return;

    if (text.includes('instagram.com/reel/')) {
        reelsDb[chatId] = reelsDb[chatId] || [];
        
        if (!reelsDb[chatId].includes(text.trim())) {
            reelsDb[chatId].push(text.trim());
            await saveReelsDb();
            return bot.sendMessage(chatId, `✅ Лінк додано до трекера!\nВсього: ${reelsDb[chatId].length}`);
        } else {
            return bot.sendMessage(chatId, `⚠️ Такий лінк вже є.`);
        }
    }

    const state = userStates.get(chatId);
    if (state) {
        handleParsingSteps(msg);
        return;
    }

    switch (text) {
        case '👥 Парсинг підписників':
            userStates.set(chatId, { step: 'usernames', parseType: 'followers' });
            bot.sendMessage(chatId, `👥 *Парсинг підписників*\n\n✍️ Введи нікнейми через кому:`, { parse_mode: 'Markdown' });
            break;

        case '📋 Парсинг підписок':
            userStates.set(chatId, { step: 'usernames', parseType: 'following' });
            bot.sendMessage(chatId, `📋 *Парсинг підписок*\n\n✍️ Введи нікнейми через кому:`, { parse_mode: 'Markdown' });
            break;
        
        case '#️⃣ Пошук по хештегу':
            userStates.set(chatId, { step: 'usernames', parseType: 'hashtag' });
            bot.sendMessage(chatId, `#️⃣ *Пошук по хештегу*\n\n✍️ Введи хештеги (можна кирилицею):`, { parse_mode: 'Markdown' });
            break;

        case '📹 Трекер Reels':
            const userLinks = reelsDb[chatId] || [];
            bot.sendMessage(chatId, 
                `📹 **Reels Tracker**\n\n` +
                `🔗 Відстежується: ${userLinks.length} відео\n` +
                `📊 Дані у Excel: URL, перегляди, лайки, коментарі\n\n` +
                `_Надішліть посилання на Reels щоб додати_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Оновити та отримати Excel', callback_data: 'tr_get_report' }],
                            [{ text: '📜 Показати список', callback_data: 'tr_list' }, 
                             { text: '🗑 Очистити всі', callback_data: 'tr_clear' }]
                        ]
                    }
                }
            );
            break;

        case '🛡️ Адмін-панель':
            if (isAdmin(chatId)) {
                if (authorizedUsers.length === 0) {
                    return bot.sendMessage(chatId, '📂 Список користувачів порожній.');
                }

                const userButtons = authorizedUsers.map(user => ([
                    { text: `${user.name || 'User'} (${user.id})`, callback_data: 'dummy' },
                    { text: '❌ Видалити', callback_data: `delete_user_${user.id}` }
                ]));

                userButtons.unshift([{ text: 'ℹ️ Як видаляти?', callback_data: 'admin_help' }]);

                bot.sendMessage(chatId, `🛡 *Адмін-Панель* (${authorizedUsers.length}):`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: userButtons }
                });
            } else {
                bot.sendMessage(chatId, '❌ Немає доступу.');
            }
            break;
            
        case '🆔 Мій ID':
             bot.sendMessage(chatId, `🆔 <code>${chatId}</code>`, { parse_mode: 'HTML' });
             break;
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = query.from;

    if (data === 'tr_get_report') {
        bot.answerCallbackQuery(query.id);
        await sendTrackerReport(chatId);
    }
    else if (data === 'tr_list') {
        const links = reelsDb[chatId] || [];
        if(!links.length) {
             bot.sendMessage(chatId, '📭 Список порожній.');
        } else {
             const fileContent = links.join('\n');
             if (links.length > 10) {
                  const buffer = Buffer.from(fileContent, 'utf-8');
                  await bot.sendDocument(chatId, buffer, {}, { filename: 'links.txt', contentType: 'text/plain'});
             } else {
                  await bot.sendMessage(chatId, `🔗 **Ваші лінки:**\n\n${links.join('\n')}`, { parse_mode: 'Markdown', disable_web_page_preview: true });
             }
        }
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'tr_clear') {
        reelsDb[chatId] = [];
        await saveReelsDb();
        await bot.sendMessage(chatId, '🗑 Список очищено.');
        bot.answerCallbackQuery(query.id);
    }
    
    else if (data === 'request_access') {
        await bot.editMessageText('⏳ Запит надіслано адміністраторам...', { chat_id: chatId, message_id: query.message.message_id });

        const failedAdmins = [];
        for (const adminId of ADMIN_IDS) {
            try {
                const safeName = escapeHtml(user.first_name || '');
                const safeUsername = user.username ? '@' + escapeHtml(user.username) : 'no_user';
                const safeId = escapeHtml(user.id);

                await bot.sendMessage(adminId,
                    `🔔 <b>Новий запит!</b>\n\n👤 ${safeName} (${safeUsername})\n🆔 <code>${safeId}</code>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Дозволити', callback_data: `approve_${user.id}_${user.first_name}` },
                                    { text: '🚫 Відхилити', callback_data: `deny_${user.id}` }
                                ]
                            ]
                        }
                    }
                );
            } catch (e) {
                console.error(`[Admin notify] Failed to send request to admin ${adminId}:`, e?.response?.data || e.message || e);
                failedAdmins.push(adminId);
            }
        }

        try {
            if (failedAdmins.length === ADMIN_IDS.length) {
                await bot.sendMessage(chatId, '❌ Не вдалося надіслати запит адміністраторам.');
            } else {
                await bot.sendMessage(chatId, '✅ Запит відправлено адміністраторам. Чекайте на відповідь.');
            }
        } catch (e) {}
    }
    else if (data.startsWith('approve_')) {
        if (!isAdmin(chatId)) return;
        const parts = data.split('_');
        const targetId = parseInt(parts[1]);
        const targetName = parts[2];

        if (!authorizedUsers.some(u => u.id === targetId)) {
            authorizedUsers.push({ id: targetId, name: targetName });
            await saveUsers();
            await bot.sendMessage(chatId, `✅ Додано: ${targetName}`);
            try { await bot.sendMessage(targetId, `🎉 *Вам надано доступ!*\nТисни /start.`, { parse_mode: 'Markdown' }); } catch (e) { }
        }
        bot.deleteMessage(chatId, query.message.message_id);
    }
    else if (data.startsWith('deny_')) {
        if (!isAdmin(chatId)) return;
        bot.deleteMessage(chatId, query.message.message_id);
    }
    else if (data.startsWith('delete_user_')) {
        if (!isAdmin(chatId)) return;
        const targetId = parseInt(data.split('_')[2]);
        authorizedUsers = authorizedUsers.filter(u => u.id !== targetId);
        await saveUsers();
        await bot.sendMessage(chatId, `🗑 Видалено.`);
        bot.deleteMessage(chatId, query.message.message_id);
    }
    else if (data === 'admin_help') {
        await bot.sendMessage(chatId, `ℹ️ Щоб видалити, натисніть хрестик.`, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }
});

console.log('🤖 SAMIParser Bot is online and ready.');