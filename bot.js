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
// Якщо змінна середовища задана (на Railway) - використовуємо її, інакше поточну папку
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// НАЛАШТУВАННЯ ПАРСИНГУ
const DEFAULT_LIMIT = 1300;        
const DEFAULT_MAX_FOLLOWERS = 1000000000; 
const CONCURRENCY_LIMIT = 5; // Безпечна кількість потоків

// ГЛОБАЛЬНИЙ ЗАХИСТ ВІД КРАШІВ
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
const userStates = new Map();
let authorizedUsers = [];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// ==========================================
// 🔐 СИСТЕМА ДОСТУПУ (PERSISTENCE)
// ==========================================

const loadUsers = async () => {
  try {
    if (DATA_DIR !== '.') {
        try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
    }
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    authorizedUsers = JSON.parse(data);
    console.log(`✅ [SYSTEM] Завантажено ${authorizedUsers.length} користувачів.`);
  } catch (error) {
    console.log('ℹ️ [SYSTEM] База користувачів створена з нуля.');
    authorizedUsers = [];
    await saveUsers();
  }
};

const saveUsers = async () => {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(authorizedUsers, null, 2));
  } catch (e) {
    console.error('Помилка збереження юзерів:', e);
  }
};

const hasAccess = (userId) => {
  return ADMIN_IDS.includes(userId) || authorizedUsers.some(u => u.id === userId);
};

const isAdmin = (userId) => {
  return ADMIN_IDS.includes(userId);
};

loadUsers();

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
// 📡 INSTAGRAM API (FULL VERBOSE VERSION)
// ==========================================

const getUserById = async (id) => {
  const body = {
    av: '17841419081024045',
    __d: 'www',
    __user: '18992364034',
    __a: '1',
    __req: '2',
    __hs: '20396.HCSV2:instagram_web_pkg.2.1...0',
    dpr: '2',
    __ccg: 'GOOD',
    __rev: '1029375730',
    __s: 'sm56uc:7gjo7n:0vxfxz',
    __hsi: '7568961909656489821',
    __dyn: '7xe6E5q5U5ObwKBAg5S1Dxu13wvoKewSAwHwNwcy0lW4o0B-q1ew6ywaq0yE460qe4o5-1ywOwa90Fw4Hw9O0M82zxe2GewGw9a361qw8W1uw2oEGdwtU662O0Lo6-3u2WE15E6O1FwlE6PhA6bwg8rAwHxW1oxe17wcObBK4o16U4q3a13wiUS5E&__csr=ggMgN15d9EG2RNAZldlX9QqGuJBrHGZFfjUHoObyHVqCzudWQVriCz8ggGcBUUwCiV7GVbDCBGt4y6iQng889WyoKeyprFa15xO7Z3UmxhoC74aBwKBUKfACAGUgzUx0VAgkufzUe8-78kK6p84C00lTd04OGi680DIEeo0kuwwwRWg560AE0hUw3RoKp03cAawp61lBgiwFml0yx605Uja8g1rE0izxO0ti01Llo0qyw2qE092o',
    __hsdp: 'lcIl24zuKhend3GBh89EaiqQmmBVpeXQhbmty45qsMSay7RtvQGbLgO8yKbAyUCUkyQ2p2tiwUkwy1IDIg14waO2e2219xXyAUy6E31xm0_80wC0xk2W03560fIw3xE0xO0se0P8',
    __hblp: '04iwQxu488U2ow5wwKz89UhxG225US2em6bzo8UC8zUpwFwFxi6UlwtodouxvyUK0iK1Tw-wCwlo5-0gym0Io1qU0GW1lw1o-2q1EwKxK0X80Hi08Ww5bw278iw9i17xW9xK0zE4a3C1fw',
    __sjsp: 'qcIl25AuK9Dd2Giyki1gDGbGFVeVkmKFS8gsl3EGcHjDy7BgO261DyGRg',
    __comet_req: '7',
    fb_dtsg: 'NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021',
    jazoest: '26546',
    lsd: 'vVbWdDNFnfguO3z1lxm1aQ',
    __spin_r: '1029375730',
    __spin_b: 'trunk',
    __spin_t: '1762286273',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisProfilePageContentQuery',
    server_timestamps: 'true',
    variables: JSON.stringify({
      enable_integrity_filters: true,
      id: id,
      render_surface: "PROFILE",
      __relay_internal__pv__PolarisProjectCannesEnabledrelayprovider: true,
      __relay_internal__pv__PolarisProjectCannesLoggedInEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
      __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false
    }),
    doc_id: '24963806849976236'
  };

  const response = await axios.post(
    'https://www.instagram.com/graphql/query',
     new URLSearchParams(body).toString(),
    {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,uk;q=0.7',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': 'ig_did=38D527BA-DD52-4034-A15D-021C637C145D; ig_nrcb=1; datr=F0V8Z4tJEDXzUwMKLnXPzQrh; ds_user_id=18992364034; csrftoken=oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u; ps_l=1; ps_n=1; mid=aGzR7wAEAAE5s66SP_Ub17hSBBcL; sessionid=18992364034%3AG2OqY11JfOr7TG%3A11%3AAYhCWu5mOAzXojXdLhN1XwN2VLMizsNx5Y9Guc3RS8M; wd=915x962; rur="CLN\\05418992364034\\0541793822123:01fefc17be789abca01ad3abe51d04655b9e5dfa90a6fb4380710ba10d0751a0bd09d83d"',
        'dnt': '1',
        'origin': 'https://www.instagram.com',
        'priority': 'u=1, i',
        'referer': 'https://www.instagram.com/ssolovei_/',
        'sec-ch-prefers-color-scheme': 'dark',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-full-version-list': '"Google Chrome";v="141.0.7390.123", "Not?A_Brand";v="8.0.0.0", "Chromium";v="141.0.7390.123"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"26.0.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'x-asbd-id': '359341',
        'x-bloks-version-id': 'd472af6df5cc606197723ed51adaa0886f926161310654a7c93600790814eba5',
        'x-csrftoken': 'oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u',
        'x-fb-friendly-name': 'PolarisProfilePageContentQuery',
        'x-fb-lsd': 'vVbWdDNFnfguO3z1lxm1aQ',
        'x-ig-app-id': '936619743392459',
        'x-root-field-name': 'fetch__XDTUserDict'
      }
    }
  );

  return response.data.data.user;
}

const getUserIdFromUsername = async (username) => {
  const generateSearchSessionId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const body = {
    av: '17841419081024045',
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: '16',
    __hs: '20396.HCSV2:instagram_web_pkg.2.1...0',
    dpr: '2',
    __ccg: 'GOOD',
    __rev: '1029375730',
    __s: '51epm7:7gjo7n:1nh6bo',
    __hsi: '7568977964973035639',
    __dyn: '7xeUjG1mxu1syUbFp41twpUnwgU7SbzEdF8aUco2qwJxS0DU2wx609vCwjE1EE2Cw8G11wBz81s8hwGxu786a3a1YwBgao6C0Mo2swlo8od8-U2zxe2GewGw9a361qwuEjUlwhEe87q0oa2-azqwt8d-2u2J0bS1LwTwKG1pg2fwxyo6O1FwlA3a3zhA6bwIxeUnAwCAxW1oxe6UaUaE2xyVrx60hK3KawOwgV84qdxq',
    __csr: 'ggMgN15d9k4cp5gD5pdMFZl_4lqRjEGlEDJpHLFt6zumvHt5ZajUGibgGcBUKyy9bELjHJ6XhqDjgxJd5Qi9GquEsDG9AAUBeVuQGighBxeazuiudx_gTBhaDBznKl1J2KAeBgTBGlDKWy99FaKumFEzCgyezEiAgkufzU9oizUsxiUpAG16w05tPg16ooGi684J05p80P92wBxe057E88duBhEaYElw9abg30w3GE3BU0KSbCg39o1TE62oWy4cgG4VA18o4pzeQ4EalBg8Ehwpo4Ou0pJwvU56u8g0GgOy40KE2zcaw14QgEjiy8wb38szQ0se01GYw4oo1V80iZw2qHw1Y20ki',
    __hsdp: 'gfts4E9MlilOgiUMIrDcrB910O34hktQRFcihKXQNLjA4oFGemn57GVikiey1ek-7A14DIhxy2C1uQ1ax93swtwXy98Wf89jAK6Eownh88o84589E2hwXDwIxS0EK1px69wh8owDxS9x2544k11gkxCE8Upw8K0TE0MW0luaw28Q0yo9o0FZ0pUlw_wiU7G0bFwXwjE0KG1cwaOaw43xUwfE3YwbG8G0P8',
    __hblp: '0uk2K1HwQxubAwzwGxO3a7oy2h4zEmw8e68kwGxp16ex2ez89UhxG5XAxudxWim5KV8y2e9y9oC6oaoao-i6QifwCx10GyFEdoO4u5ubKuu2i4UC7o24Ua8ixS4oC8wwyVVEoXxy8xS9x2544k4o4l1yE8Upw8K3Km0D8kwaq0N81zo188dEG4U0wZ08C2m0X82twda11gbo9Eixm3-2W6Q1WwnUgw2u8eU4W1Gw60wfW5F8c86DwAxKaxa0W9A5Vy0Fxi4E2kwhUOeG9xK0wEyE4a3C1fw',
    __sjsp: 'gfts4E9MlilFT13z2PjpP6ViggcwN4l7tdqj4AhbBj6ZeghyCEVpNhWKmh4zEyvzo7C0g93o',
    __comet_req: '7',
    fb_dtsg: 'NAfu_KPXWlV8VPP2ejtHV8eoXr7tj3VBBdfuVLaJdLZNcIRC32e0KpQ:17864970403026470:1744117021',
    jazoest: '26173',
    lsd: 'Qc7e8U7k_bYsc1O9R2qt8p',
    __spin_r: '1029375730',
    __spin_b: 'trunk',
    __spin_t: '1762290011',
    __crn: 'comet.igweb.PolarisProfilePostsTabRoute',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisSearchBoxRefetchableQuery',
    server_timestamps: 'true',
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
    }),
    doc_id: '24146980661639222'
  };

  const response = await axios.post(
    'https://www.instagram.com/graphql/query',
    new URLSearchParams(body).toString(),
    {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,uk;q=0.7',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': 'ig_did=38D527BA-DD52-4034-A15D-021C637C145D; ig_nrcb=1; datr=F0V8Z4tJEDXzUwMKLnXPzQrh; ds_user_id=18992364034; csrftoken=oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u; ps_l=1; ps_n=1; mid=aGzR7wAEAAE5s66SP_Ub17hSBBcL; sessionid=18992364034%3AG2OqY11JfOr7TG%3A11%3AAYhCWu5mOAzXojXdLhN1XwN2VLMizsNx5Y9Guc3RS8M; wd=915x962; rur="CLN\\05418992364034\\0541793826676:01fe67a3558abfda92d8fd0cba55a65b6f78c06ac7e851fba7cb9dda510c3f991c456595"',
        'dnt': '1',
        'origin': 'https://www.instagram.com',
        'priority': 'u=1, i',
        'referer': 'https://www.instagram.com/ssolovei_/',
        'sec-ch-prefers-color-scheme': 'dark',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-full-version-list': '"Google Chrome";v="141.0.7390.123", "Not?A_Brand";v="8.0.0.0", "Chromium";v="141.0.7390.123"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"26.0.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'x-asbd-id': '359341',
        'x-bloks-version-id': 'd472af6df5cc606197723ed51adaa0886f926161310654a7c93600790814eba5',
        'x-csrftoken': 'oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u',
        'x-fb-friendly-name': 'PolarisSearchBoxRefetchableQuery',
        'x-fb-lsd': 'Qc7e8U7k_bYsc1O9R2qt8p',
        'x-ig-app-id': '936619743392459',
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
    throw new Error(`User with username "${username}" not found in search results`);
  }

  return result.user.id;
}

// МОДИФІКОВАНИЙ ФЕТЧЕР З ЛІМІТОМ
const getAllFollowers = async (id, limitAmount) => {
  let next_max_id = null;
  let hasMore = true;
  const ids = [];

  while (hasMore) {
    // Перевірка ліміту, щоб не банили за зайві запити
    if (ids.length >= limitAmount) break;

    try {
        const response = await axios.get(
          `https://www.instagram.com/api/v1/friendships/${id}/following/?count=200${next_max_id ? `&max_id=${next_max_id}` : ''}`,
          {
            headers: {
              'accept': '*/*',
              'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,uk;q=0.7',
              'cookie': 'ig_did=38D527BA-DD52-4034-A15D-021C637C145D; ig_nrcb=1; datr=F0V8Z4tJEDXzUwMKLnXPzQrh; ds_user_id=18992364034; csrftoken=oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u; ps_l=1; ps_n=1; mid=aGzR7wAEAAE5s66SP_Ub17hSBBcL; sessionid=18992364034%3AG2OqY11JfOr7TG%3A11%3AAYhCWu5mOAzXojXdLhN1XwN2VLMizsNx5Y9Guc3RS8M; wd=915x962; rur="CLN\\05418992364034\\0541793822047:01fe8567b846c70d8350d6ca5a66944fa085c28c68ea83e3dda1a3677d44bb1e3c3cc83d"',
              'dnt': '1',
              'priority': 'u=1, i',
              'referer': 'https://www.instagram.com/ssolovei_/following/',
              'sec-ch-prefers-color-scheme': 'dark',
              'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
              'sec-ch-ua-full-version-list': '"Google Chrome";v="141.0.7390.123", "Not?A_Brand";v="8.0.0.0", "Chromium";v="141.0.7390.123"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-model': '""',
              'sec-ch-ua-platform': '"macOS"',
              'sec-ch-ua-platform-version': '"26.0.1"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
              'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
              'x-asbd-id': '359341',
              'x-csrftoken': 'oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u',
              'x-ig-app-id': '936619743392459',
              'x-web-session-id': '8qqznb:7gjo7n:hmve9m'
            }
          }
        );

        ids.push(...response.data.users.map(item => item.id));
        hasMore = response.data.has_more;
        next_max_id = response.data.next_max_id;
        // Динамічна пауза між сторінками
        await randomSleep(500, 1200);
    } catch (e) {
        // Якщо сторінка не вантажиться, просто зупиняємося і віддаємо що є
        hasMore = false;
    }
  }

  // Повертаємо тільки потрібну кількість
  return ids.slice(0, limitAmount);
}

const getReels = async (userId, { after = null, first = 7, pageSize = 2 } = {}) => {
  const body = {
    av: '17841419081024045',
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: '3a',
    __hs: '20402.HCSV2:instagram_web_pkg.2.1...0',
    dpr: '2',
    __ccg: 'GOOD',
    __rev: '1029645341',
    __s: 'vj1axo:f39icq:b7q9h8',
    __hsi: '7571145547497363938',
    __dyn: '7xeUjG1mxu1syUbFp41twpUnwgU7SbzEdF8aUco2qwJxS0DU2wx609vCwjE1EE2Cw8G11wBz81s8hwGxu786a3a1YwBgao6C0Mo2iyo5m263ifK0EUjwGzEaE2iwNwmE7G4-5o4q3y1Sw62wLyESE7i3vwDwHg2ZwrUdUbGwmk0zU8oC1Iwqo5p0OwUQp1yUb8jK5V89F8uwm8jxK2K2G0EoKmUhw4rwXyEcE4ei16wAw',
    __csr: 'g9Y4AICG79MPfd5Hlnf6AlPOPnAjVqvHb-AQSiSayp8hBqhWAF4lWAtemRGlfWjGVCaO4SnvLF7yGjzUhUOiuuEKehuVH-QidyqyOpriXV-h2USZanK2i6ippAqifCgTHKb_xfAy9ojF7GEW8xijtAKqF9HCiAxO8AwFjz4V9QiUuxmdJet6zoG49o-8DwiE01oZoSaK7A1jgbE5Rw23VDg8bwdhfVda4agmw2we2C0zoaWgrxq0pW0eBweWE0-WEjg1XA264jwBwhZ1-p0Cx68Q0JojwJxe0sKpa1vxK3K5Q1YwcK48z80jwi0hK0FbOo4hw3MMCEalCwyhD406dxO7806dK0eEway0W80HJw2hU0d284u',
    __hsdp: 'g5naL1euF51c2AHkxFGPEiIRciJ20jKhijJdySussFWK45izCm4revda1q5y6y5B40gETmUyERy9E4pyi6wmUJBx51GA8xGEgpO2FEnwnp8iiyzw9a2-12w-zE5i9zE5q5bw8-10yVEGvwwxXxG32323OdwIxC2Wi0r-0kGq0oS1cwPw5Zw4wBwr8bo6e7o6G1bw6cwcm1Qw22o622x05_wk8fo5gw32xm0DE',
    __hblp: '0vEfE25gO4u5olybwMx-8xueUW7obo2SyEkyp8y4efAxK4Unp8W3C4ryVVoixNpAm5UoQcAUnxG3Zp8Z2AewJwo9F8ky9oKi350ZzEgx-m6SvzEGUoAwFxjU2cm2G5rBVEGvwwzogUKdgc9Eak3KdwADxC3m2y0z88o3Bw9a0JVFE1xE4O3e2i68720HUuw-wdedBwr8boe8aEgz8coe84K5Usw5nwcm585-1yw8W0hu7EaEmK2h2Elw820w85uQay8gyUvwZCwNK5O1e484rwl8lwn846',
    __sjsp: 'g5fsGYA4hWAk4MaiJi6CHexaPkNaQ81eV5neQSbgyssFWK45izCm5oS9g5Mm8o6DmUKdoy0OS5Q',
    __comet_req: '7',
    fb_dtsg: 'NAfvUDaiJyFYbA47EW4SWF2hyqrpiw4h0ex6tdXjlP3Eo0nTAtF9tJQ:17864970403026470:1744117021',
    jazoest: '26265',
    lsd: 'mzId0ZjTQCzWXqrpB2fKO_',
    __spin_r: '1029645341',
    __spin_b: 'trunk',
    __spin_t: '1762794691',
    __crn: 'comet.igweb.PolarisProfileReelsTabRoute',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisProfileReelsTabContentQuery_connection',
    server_timestamps: 'true',
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
    }),
    doc_id: '9905035666198614'
  };

  const response = await axios.post(
    'https://www.instagram.com/graphql/query',
    new URLSearchParams(body).toString(),
    {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,uk;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': 'ig_did=38D527BA-DD52-4034-A15D-021C637C145D; ig_nrcb=1; datr=F0V8Z4tJEDXzUwMKLnXPzQrh; ds_user_id=18992364034; csrftoken=oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u; ps_l=1; ps_n=1; mid=aGzR7wAEAAE5s66SP_Ub17hSBBcL; sessionid=18992364034%3AG2OqY11JfOr7TG%3A11%3AAYiZlCyqjp7i11_QhphJf9P-VyFWoe86TNfS1jvGPk0; wd=973x962; rur="CLN\\05418992364034\\0541794331174:01fe77eac557be1bd0a79d2111cf62762a40e4fa39f1dfa57a8ff7d12eb364d66a16fd09"',
        'dnt': '1',
        'origin': 'https://www.instagram.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.instagram.com/andreabuueno/reels/',
        'sec-ch-prefers-color-scheme': 'dark',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-full-version-list': '"Google Chrome";v="141.0.7390.123", "Not?A_Brand";v="8.0.0.0", "Chromium";v="141.0.7390.123"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"26.0.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'x-asbd-id': '359341',
        'x-bloks-version-id': 'e931ff03adc522742d788ba659da2ded4fb760f51c8576b5cd93cdaf3987e4b0',
        'x-csrftoken': 'oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u',
        'x-fb-friendly-name': 'PolarisProfileReelsTabContentQuery_connection',
        'x-fb-lsd': 'mzId0ZjTQCzWXqrpB2fKO_',
        'x-ig-app-id': '936619743392459',
        'x-root-field-name': 'xdt_api__v1__clips__user__connection_v2'
      }
    }
  );

  return response.data.data.xdt_api__v1__clips__user__connection_v2.edges.reduce((acc, edge) => {
    const media = edge.node.media;
    if (media.clips_tab_pinned_user_ids.length) {
      return acc;
    }

    acc.push(media.play_count);
    return acc;
  }, []).slice(0, 7);
}

const getPosts = async (username, { count = 12, includeReelMediaSeenTimestamp = true, includeRelationshipInfo = true, latestBestiesReelMedia = true, latestReelMedia = true } = {}) => {
  const body = {
    av: '17841419081024045',
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: '6',
    __hs: '20402.HCSV2:instagram_web_pkg.2.1...0',
    dpr: '2',
    __ccg: 'MODERATE',
    __rev: '1029645341',
    __s: 'gkgx7w:42ca4h:z972uj',
    __hsi: '7571169926051092580',
    __dyn: '7xeUjG1mxu1syUbFp41twpUnwgU7SbzEdF8aUco2qwJxS0DU2wx609vCwjE1EE2Cw8G11wBz81s8hwGxu786a3a1YwBgao6C0Mo2swlo8od8-U2zxe2GewGw9a361qwuEjUlwhEe87q0oa2-azqwt8d-2u2J0bS1LwTwKG1pg2fwxyo6O1FwlA3a3zhA6bwIxeUnAwCAxW1oxe6UaU3cyVrx60hK16wOwgV84q2i',
    __csr: 'g9Yr7jOOqFNisl7vZWn9HGAz9WFAFGQJszChoxKh-WACy6598hBqyaAGlvGmAVrmFpfF6KpyIxdBTXWhUGAU-4ucADDGbzAnKq_J1a9Gb9BJbK9Cz8SZanK3UCmp6AzVAdWXy_UjV8ym4WhWGey8kCtAKqF9EFai78S2B11eit4K7ElzrjDhES6Vo-8Dw05B0zoGUug5d0Kwnm08fCt0wK0R4_AQEgF1q0a0Uao2dwKgrxq0pW0eBweWE0-WEjg1XA264jwBwhZ1-p0Cx68Q0JojwJxe0sKuE5-6UeUng7O0OUgycw1e1816U2AL9wh60f32qwFmq296sg0oS78sw0oSU0Wy0G83Ew2KS097w0Q8whU',
    __hsdp: 'geQ6AGY4VWAk4MaiJi6CHni4H9yjbywjeh9344UYsdxyEabe9da1q53y5B40gEvwywhC98q1rxe2SA8xGEgpO2FEnwnp8iiyzw9a2-12w-zE5i9zE5q5bw8-10yVEGvwwxXxG32323OdwIxC2Wi0r-0kGq0oS1cwPw5Zw4wBwr8bo6e7o6G1bw6cwcm1Qw22o622x05_wk8fo5gw32xm0DE',
    __hblp: '0vEfE26z8fUO0To2SwFzo8Ed8uzE4KUKdwLmp1S6d39e5Uqw_mifgKewJwo9Epy9oK3p0ZzEgx-m6SvzEW698aok-0z5wGxmVuqaDU88S4ebzEc8c8f8S2iu6odo2Rwxwem0AE2TCCw66wj8cU9829wa-7EfE3jzpo6O2S3y2G48O363y1bxu781lU35wt86a0qq7EaEmK2h2Elw820w85uQay8gyUvwZCwNK5O1e484y1kxm1swgo',
    __sjsp: 'geQ65OHOgh7Ghgj0F8hi6CHni4H9yjbywjehadg8NMS6awIxt0n1g',
    __comet_req: '7',
    fb_dtsg: 'NAftOiTjchy2lfmwzberNk3v_oULJxNhIomtC98mJQ1N_NnAZr3fNnA:17864970403026470:1744117021',
    jazoest: '26525',
    lsd: '8ZETyCAtEkQCVF8qwhGudE',
    __spin_r: '1029645341',
    __spin_b: 'trunk',
    __spin_t: '1762800367',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisProfilePostsQuery',
    server_timestamps: 'true',
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
    }),
    doc_id: '24937007899300943'
  };

  const response = await axios.post(
    'https://www.instagram.com/graphql/query',
    new URLSearchParams(body).toString(),
    {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,uk;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': 'ig_did=38D527BA-DD52-4034-A15D-021C637C145D; ig_nrcb=1; datr=F0V8Z4tJEDXzUwMKLnXPzQrh; ds_user_id=18992364034; csrftoken=oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u; ps_l=1; ps_n=1; mid=aGzR7wAEAAE5s66SP_Ub17hSBBcL; sessionid=18992364034%3AG2OqY11JfOr7TG%3A11%3AAYiZlCyqjp7i11_QhphJf9P-VyFWoe86TNfS1jvGPk0; dpr=2; wd=917x962; rur="CLN\\05418992364034\\0541794336341:01feca1ca8cf8268b0feab62ed27984328b85e36a2c939b9f5035dc6e6d4ca62150fbf61"',
        'dnt': '1',
        'origin': 'https://www.instagram.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': `https://www.instagram.com/${username}/`,
        'sec-ch-prefers-color-scheme': 'dark',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-full-version-list': '"Google Chrome";v="141.0.7390.123", "Not?A_Brand";v="8.0.0.0", "Chromium";v="141.0.7390.123"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"26.0.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'x-asbd-id': '359341',
        'x-bloks-version-id': 'e931ff03adc522742d788ba659da2ded4fb760f51c8576b5cd93cdaf3987e4b0',
        'x-csrftoken': 'oYY6Tkt9TxFg9Wxl9ElfnXPmExJXyY1u',
        'x-fb-friendly-name': 'PolarisProfilePostsQuery',
        'x-fb-lsd': '8ZETyCAtEkQCVF8qwhGudE',
        'x-ig-app-id': '936619743392459',
        'x-root-field-name': 'xdt_api__v1__feed__user_timeline_graphql_connection'
      }
    }
  );

  const edges = response.data.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges;
  return edges.map((edge) => edge.node.caption?.text || '').filter(Boolean).join(', ');
}

// ==========================================
// 🧹 ОБРОБКА ДАНИХ
// ==========================================

const processSingleUser = async (id, min, max) => {
  try {
    await randomSleep(300, 1200); // Збільшив затримку для стабільності

    const user = await getUserById(id);
    const followerCount = user.follower_count;

    if (followerCount > min && followerCount < max) {
      const [reelsViews, posts] = await Promise.all([
        getReels(id, { pageSize: 20 }).catch(() => []),
        getPosts(user.username, { count: 12 }).catch(() => '')
      ]);

      const averageReelsViews = reelsViews.length > 0 
        ? reelsViews.reduce((acc, curr) => acc + curr, 0) / reelsViews.length 
        : 0;

      const languages = detectAll(posts).slice(0, 2);

      return {
        username: user.username,
        full_name: user.full_name,
        follower_count: formatNumber(followerCount),
        profile_pic_url: user.profile_pic_url,
        url: `https://www.instagram.com/${user.username}/`,
        email: extractEmail(user.biography),
        average: formatNumber(averageReelsViews.toFixed(2)),
        rawAverage: averageReelsViews,
        languages: languages.map((lang) => `${lang.lang} - ${(lang.accuracy).toFixed(2)}`).join(', ')
      };
    }
    return null;
  } catch (e) {
    // Ігноруємо помилки окремих юзерів
    return null;
  }
};

const mapFollowers = async ({ ids, limit: processLimit, min, max }, onProgress) => {
  const result = [];
  const total = Math.min(ids.length, processLimit);
  let processedCount = 0;

  // Створюємо список завдань, але не більше ліміту
  const tasks = ids.slice(0, total).map((id) => {
    return limit(async () => {
      const data = await processSingleUser(id, min, max);
      processedCount++;
      if (onProgress) {
        const currentName = data ? data.username : '...';
        onProgress(processedCount, total, currentName);
      }
      if (data) result.push(data);
    });
  });

  await Promise.all(tasks);
  return result;
};

const saveToXlsx = async (result, baseFilename) => {
  if (result.length > 0) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Results');

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

    worksheet.getRow(1).height = 30;
    worksheet.getRow(1).font = { bold: true };

    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      const row = worksheet.addRow({
        username: item.username || '',
        url: item.url || '',
        full_name: item.full_name || '',
        follower_count: item.follower_count || 0,
        email: item.email || '',
        average: item.average || '',
        languages: item.languages
      });

      row.height = 80; 

      if (item.profile_pic_url) {
        try {
          const imageResponse = await axios.get(item.profile_pic_url, { responseType: 'arraybuffer' });
          const imageId = workbook.addImage({
            buffer: imageResponse.data,
            extension: 'jpeg',
          });
          worksheet.addImage(imageId, {
            tl: { col: 0, row: i + 1 },
            ext: { width: 80, height: 80 }
          });
        } catch (err) {}
      }
    }

    const cleanName = baseFilename.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
    const filename = `${cleanName}.xlsx`;
    await workbook.xlsx.writeFile(filename);
    return filename;
  }
  return null;
}

// ==========================================
// 🤖 TELEGRAM BOT INTERFACE
// ==========================================

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (hasAccess(chatId)) {
    bot.sendMessage(chatId, 
      `👋 *Привіт! SAMIParser активний.*\n\n` +
      `Готовий шукати цільову аудиторію.`, 
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Почати Парсинг', callback_data: 'start_parsing' }],
            [{ text: '📚 Гайд', callback_data: 'user_guide' }]
          ]
        }
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

// Адмін-панель
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

// Callbacks (Кнопки)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const user = query.from;

  // Запит доступу
  if (data === 'request_access') {
    await bot.editMessageText('⏳ Запит надіслано адміністраторам...', { chat_id: chatId, message_id: query.message.message_id });

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.sendMessage(adminId, 
          `🔔 *Новий запит!*\n\n👤 ${user.first_name} (@${user.username || 'no_user'})\n🆔 \`${user.id}\``, 
          {
            parse_mode: 'Markdown',
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
      } catch (e) {}
    }
  }

  // Адмін дії
  else if (data.startsWith('approve_')) {
    if (!isAdmin(chatId)) return;
    const parts = data.split('_');
    const targetId = parseInt(parts[1]);
    const targetName = parts[2];

    if (!authorizedUsers.some(u => u.id === targetId)) {
      authorizedUsers.push({ id: targetId, name: targetName });
      await saveUsers();
      await bot.sendMessage(chatId, `✅ Додано: ${targetName}`);
      try { await bot.sendMessage(targetId, `🎉 *Вам надано доступ!*\nТисни /start.`, { parse_mode: 'Markdown' }); } catch (e) {}
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

  // Старт парсингу
  else if (data === 'start_parsing') {
    if (!hasAccess(chatId)) return;
    userStates.set(chatId, { step: 'usernames' });
    await bot.sendMessage(chatId, `✍️ *Крок 1/2*\nВведи нікнейми через кому:\n_(напр. zelenskyy, emrata)_`, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(query.id);
  }
  
  // Довідка
  else if (data === 'user_guide') {
    bot.sendMessage(chatId, `📚 *Гайд:*\n1. Натисніть "Почати".\n2. Введіть нікнейми.\n3. Вкажіть мін. підписників.\n4. Бот надішле файл після кожного акаунта.`, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'admin_help') {
    bot.sendMessage(chatId, `ℹ️ Щоб видалити, натисніть хрестик.`, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(query.id);
  }
});

// Обробка тексту (Wizard Flow)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  if (!hasAccess(chatId)) return;

  const state = userStates.get(chatId);
  if (!state) return;

  try {
    switch (state.step) {
      case 'usernames':
        const usernames = text.split(',').map(u => u.trim().replace('@', '')).filter(Boolean);
        if (usernames.length === 0) return bot.sendMessage(chatId, '⚠️ Введіть хоча б один нік.');

        state.usernames = usernames;
        state.step = 'min_followers';
        await bot.sendMessage(chatId, 
            `✅ Прийнято: **${usernames.length}** акаунтів.\n\n` +
            `✍️ *Крок 2/2*\n` +
            `Вкажіть **мінімальну** кількість підписників (напр. 1000):`, 
            { parse_mode: 'Markdown' });
        break;

      case 'min_followers':
        const min = parseInt(text);
        if (isNaN(min)) return bot.sendMessage(chatId, '❌ Це має бути число.');
        
        state.min = min;
        state.max = DEFAULT_MAX_FOLLOWERS;
        state.limit = DEFAULT_LIMIT;
        
        userStates.delete(chatId);
        await startScrapingProcess(chatId, state);
        break;
    }
  } catch (error) {
    bot.sendMessage(chatId, `⚠️ Помилка: ${error.message}`);
    userStates.delete(chatId);
  }
});

// Обробка помилок polling
bot.on('polling_error', (error) => {
  console.log(`[Polling Error] ${error.code}: ${error.message}`);
});

// ==========================================
// 🚀 ОСНОВНИЙ ПРОЦЕС
// ==========================================

async function startScrapingProcess(chatId, config) {
  let msgId = (await bot.sendMessage(chatId, `🛰 *Ініціалізація...*`, { parse_mode: 'Markdown' })).message_id;

  try {
    for (let i = 0; i < config.usernames.length; i++) {
        const currentUsername = config.usernames[i];
        
        // Блок try/catch для ізоляції помилок (щоб 403 не зупиняв весь процес)
        try {
            await bot.editMessageText(
                `📡 **SAMIParser Active**\n` +
                `━━━━━━━━━━━━\n` +
                `📂 Джерело [${i+1}/${config.usernames.length}]: \`${currentUsername}\`\n` +
                `⏳ Отримую метадані...`, 
                { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
            );

            const targetId = await getUserIdFromUsername(currentUsername);
            
            // Передаємо ліміт, щоб не качати зайвого
            const allIds = await getAllFollowers(targetId, config.limit);
            
            if (allIds.length === 0) {
               await bot.sendMessage(chatId, `⚠️ Помилка з \`${currentUsername}\`: Не вдалося отримати підписників.`);
               continue; 
            }

            // Розумний ліміт: беремо менше з двох (знайдено або ліміт)
            const toCheck = Math.min(allIds.length, config.limit);

            await bot.editMessageText(
              `📡 **SAMIParser Active**\n` +
              `━━━━━━━━━━━━\n` +
              `📂 Джерело: \`${currentUsername}\`\n` +
              `👥 Знайдено: ${allIds.length}\n` +
              `🎯 Ціль: ${toCheck} перевірок\n` +
              `🚀 *Запуск двигунів...*`, 
              { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
            );

            let lastUpdate = Date.now();
            const progressCallback = async (current, total, activeUser) => {
                const now = Date.now();
                // Оновлюємо статус не частіше ніж раз на 2.5 сек, щоб не отримати бан від Телеграму
                if (now - lastUpdate > 2500 || current === total) {
                    try {
                        await bot.editMessageText(
                            `📡 **SAMIParser Active**\n` +
                            `━━━━━━━━━━━━\n` +
                            `📂 Джерело: \`${currentUsername}\`\n` +
                            `👤 Аналіз: \`${activeUser}\`\n` +
                            `${getProgressBar(current, total)}\n` +
                            `🔢 Оброблено: ${current}/${total}\n` +
                            `━━━━━━━━━━━━`,
                            { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
                        );
                        lastUpdate = now;
                    } catch (e) { }
                }
            };

            const accountResults = await mapFollowers({ 
                ids: allIds, limit: toCheck, min: config.min, max: config.max 
            }, progressCallback);

            // Сортування результатів
            accountResults.sort((a, b) => b.rawAverage - a.rawAverage);

            if (accountResults.length === 0) {
                 await bot.sendMessage(chatId, `❌ По \`${currentUsername}\` нічого не знайдено (0 лідів).`, { parse_mode: 'Markdown' });
            } else {
                await bot.editMessageText(`💾 *Формую звіт для ${currentUsername}...* (Всього: ${accountResults.length})`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
                
                const filename = await saveToXlsx(accountResults, currentUsername);

                if (filename) {
                    const fileBuffer = await fs.readFile(filename);
                    await bot.sendDocument(chatId, fileBuffer, {
                        caption: `✅ *Звіт по ${currentUsername}*\n` +
                                 `💎 Знайдено: **${accountResults.length}**\n` +
                                 `📊 Фільтр: >${formatNumber(config.min)}`,
                        parse_mode: 'Markdown'
                    }, { filename: filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

                    await fs.unlink(filename);
                }
            }

        } catch (accError) {
            // ТУТ ЛОВИМО 403 ПОМИЛКУ, ПИШЕМО ПРО НЕЇ І ЙДЕМО ДАЛІ
            await bot.sendMessage(chatId, `⚠️ Критична помилка з \`${currentUsername}\`: ${accError.message}. Переходжу до наступного...`, { parse_mode: 'Markdown' });
        }
    }

    await bot.editMessageText(`✅ *Всі завдання виконано!*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });

  } catch (e) {
    const errText = `❌ *Глобальний збій:* ${e.message}`;
    if (msgId) await bot.editMessageText(errText, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
    else await bot.sendMessage(chatId, errText, { parse_mode: 'Markdown' });
  }
}

console.log('🤖 SAMIParser Bot is online and ready.');