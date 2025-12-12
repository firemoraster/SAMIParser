import axios from 'axios';
import { detectAll } from 'tinyld';

import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// =============================
// 🔐 COOKIES LOADING + ENCRYPTION
// =============================

const RAW_COOKIE = (process.env.INSTAGRAM_COOKIE || "").trim();
const COOKIE_ENC_PATH = process.env.COOKIE_ENC_PATH || './cookies.enc';
const COOKIE_KEY = process.env.COOKIE_KEY || "";
const COOKIE_SALT = process.env.COOKIE_SALT || "lab-salt";

function deriveKey(password) {
  return crypto.scryptSync(password, COOKIE_SALT, 32);
}

function encryptText(plain, password) {
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptText(b64, password) {
  const raw = Buffer.from(b64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const key = deriveKey(password);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function getCookieValue(cookieHeader, name) {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

async function loadCookieHeader() {
  if (RAW_COOKIE) return RAW_COOKIE;

  if (!COOKIE_KEY) {
    throw new Error(
      "No cookies provided. Put INSTAGRAM_COOKIE in .env OR provide COOKIE_KEY + cookies.enc"
    );
  }

  try {
    const b64 = (await fs.readFile(COOKIE_ENC_PATH, "utf8")).trim();
    if (!b64) throw new Error(`Encrypted cookies file is empty: ${COOKIE_ENC_PATH}`);
    return decryptText(b64, COOKIE_KEY).trim();
  } catch (error) {
    throw new Error(`Failed to load cookies: ${error.message}`);
  }
}

export async function igHeaders(extra = {}) {
  const cookie = await loadCookieHeader();
  const csrftoken = getCookieValue(cookie, "csrftoken");

  return {
    accept: "*/*",
    "accept-language": "uk,en-US;q=0.9,en;q=0.8,ru;q=0.7",
    "content-type": "application/x-www-form-urlencoded",
    cookie,
    dnt: "1",
    origin: "https://www.instagram.com",
    priority: "u=1, i",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "x-asbd-id": "359341",
    "x-ig-app-id": "936619743392459",
    ...(csrftoken ? { "x-csrftoken": csrftoken } : {}),
    ...extra,
  };
}

// =============================
// 🧩 ОСНОВНА ЛОГІКА API
// =============================

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export const extractEmail = (text) => {
  const match = String(text || "").match(EMAIL_REGEX);
  return match ? match[0] : null;
};

export const getUserById = async (id) => {
  const body = {
    av: "17841419081024045",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "2",
    __hs: "20396.HCSV2:instagram_web_pkg.2.1...0",
    dpr: "2",
    __ccg: "GOOD",
    __rev: "1029375730",
    __s: "sm56uc:7gjo7n:0vxfxz",
    __hsi: "7568961909656489821",
    __dyn:
      "7xe6E5q5U5ObwKBAg5S1Dxu13wvoKewSAwHwNwcy0lW4o0B-q1ew6ywaq0yE460qe4o5-1ywOwa90Fw4Hw9O0M82zxe2GewGw9a361qw8W1uw2oEGdwtU662O0Lo6-3u2WE15E6O1FwlE6PhA6bwg8rAwHxW1oxe17wcObBK4o16U4q3a13wiUS5E",
    __csr:
      "ggMgN15d9EG2RNAZldlX9QqGuJBrHGZFfjUHoObyHVqCzudWQVriCz8ggGcBUUwCiV7GVbDCBGt4y6iQng889WyoKeyprFa15xO7Z3UmxhoC74aBwKBUKfACAGUgzUx0VAgkufzUe8-78kK6p84C00lTd04OGi680DIEeo0kuwwwRWg560AE0hUw3RoKp03cAawp61lBgiwFml0yx605Uja8g1rE0izxO0ti01Llo0qyw2qE092o",
    __hsdp:
      "lcIl24zuKhend3GBh89EaiqQmmBVpeXQhbmty45qsMSay7RtvQGbLgO8yKbAyUCUkyQ2p2tiwUkwy1IDIg14waO2e2219xXyAUy6E31xm0_80wC0xk2W03560fIw3xE0xO0se0P8",
    __hblp:
      "04iwQxu488U2ow5wwKz89UhxG225US2em6bzo8UC8zUpwFwFxi6UlwtodouxvyUK0iK1Tw-wCwlo5-0gym0Io1qU0GW1lw1o-2q1EwKxK0X80Hi08Ww5bw278iw9i17xW9xK0zE4a3C1fw",
    __sjsp: "qcIl25AuK9Dd2Giyki1gDGbGFVeVkmKFS8gsl3EGcHjDy7BgO261DyGRg",
    __comet_req: "7",
    fb_dtsg: "NAft2vrU9tXgRSNVV0D_i_ralk2AzRL_Akiom9vq0o_kQSRbSxPrPvw:17864970403026470:1744117021",
    jazoest: "26546",
    lsd: "vVbWdDNFnfguO3z1lxm1aQ",
    __spin_r: "1029375730",
    __spin_b: "trunk",
    __spin_t: "1762286273",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisProfilePageContentQuery",
    server_timestamps: "true",
    variables: JSON.stringify({
      enable_integrity_filters: true,
      id: id,
      render_surface: "PROFILE",
      __relay_internal__pv__PolarisProjectCannesEnabledrelayprovider: true,
      __relay_internal__pv__PolarisProjectCannesLoggedInEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
      __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false,
    }),
    doc_id: "24963806849976236",
  };

  try {
    const response = await axios.post(
      "https://www.instagram.com/graphql/query",
      new URLSearchParams(body).toString(),
      {
        headers: await igHeaders({
          referer: "https://www.instagram.com/",
          "x-fb-friendly-name": "PolarisProfilePageContentQuery",
          "x-fb-lsd": "vVbWdDNFnfguO3z1lxm1aQ",
          "x-root-field-name": "fetch__XDTUserDict",
        }),
        timeout: 30000,
      }
    );

    return response.data?.data?.user;
  } catch (error) {
    console.error(`❌ Помилка отримання користувача ${id}:`, error.message);
    throw error;
  }
};

export const getUserIdFromUsername = async (username) => {
  const generateSearchSessionId = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

  const body = {
    av: "17841419081024045",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "16",
    __hs: "20396.HCSV2:instagram_web_pkg.2.1...0",
    dpr: "2",
    __ccg: "GOOD",
    __rev: "1029375730",
    __s: "51epm7:7gjo7n:1nh6bo",
    __hsi: "7568977964973035639",
    __dyn:
      "7xeUjG1mxu1syUbFp41twpUnwgU7SbzEdF8aUco2qwJxS0DU2wx609vCwjE1EE2Cw8G11wBz81s8hwGxu786a3a1YwBgao6C0Mo2swlo8od8-U2zxe2GewGw9a361qwuEjUlwhEe87q0oa2-azqwt8d-2u2J0bS1LwTwKG1pg2fwxyo6O1FwlA3a3zhA6bwIxeUnAwCAxW1oxe6UaUaE2xyVrx60hK3KawOwgV84qdxq",
    __csr:
      "ggMgN15d9k4cp5gD5pdMFZl_4lqRjEGlEDJpHLFt6zumvHt5ZajUGibgGcBUKyy9bELjHJ6XhqDjgxJd5Qi9GquEsDG9AAUBeVuQGighBxeazuiudx_gTBhaDBznKl1J2KAeBgTBGlDKWy99FaKumFEzCgyezEiAgkufzU9oizUsxiUpAG16w05tPg16ooGi684J05p80P92wBxe057E88duBhEaYElw9abg30w3GE3BU0KSbCg39o1TE62oWy4cgG4VA18o4pzeQ4EalBg8Ehwpo4Ou0pJwvU56u8g0GgOy40KE2zcaw14QgEjiy8wb38szQ0se01GYw4oo1V80iZw2qHw1Y20ki",
    __comet_req: "7",
    fb_dtsg: "NAfu_KPXWlV8VPP2ejtHV8eoXr7tj3VBBdfuVLaJdLZNcIRC32e0KpQ:17864970403026470:1744117021",
    jazoest: "26173",
    lsd: "Qc7e8U7k_bYsc1O9R2qt8p",
    __spin_r: "1029375730",
    __spin_b: "trunk",
    __spin_t: "1762290011",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisSearchBoxRefetchableQuery",
    server_timestamps: "true",
    variables: JSON.stringify({
      data: {
        context: "blended",
        include_reel: "true",
        query: username,
        rank_token: "",
        search_session_id: generateSearchSessionId(),
        search_surface: "web_top_search",
      },
      hasQuery: true,
    }),
    doc_id: "24146980661639222",
  };

  try {
    const response = await axios.post(
      "https://www.instagram.com/graphql/query",
      new URLSearchParams(body).toString(),
      {
        headers: await igHeaders({
          referer: "https://www.instagram.com/",
          "x-fb-friendly-name": "PolarisSearchBoxRefetchableQuery",
          "x-fb-lsd": "Qc7e8U7k_bYsc1O9R2qt8p",
          "x-root-field-name": "xdt_api__v1__fbsearch__topsearch_connection",
        }),
        timeout: 30000,
      }
    );

    const users =
      response.data?.data?.xdt_api__v1__fbsearch__topsearch_connection?.users || [];
    if (!users.length) throw new Error(`User "${username}" not found`);

    const exact = users.find(
      (u) => u.user?.username?.toLowerCase() === username.toLowerCase()
    );
    if (!exact) throw new Error(`User "${username}" not found in results`);

    return exact.user.id;
  } catch (error) {
    console.error(`❌ Помилка пошуку користувача ${username}:`, error.message);
    throw error;
  }
};

export const getAllFollowers = async (id, limit = Infinity, progressCallback = null) => {
  let next_max_id = null;
  let hasMore = true;
  const ids = [];
  let pageCount = 0;

  while (hasMore && ids.length < limit) {
    pageCount++;
    const url = `https://www.instagram.com/api/v1/friendships/${id}/following/?count=200${next_max_id ? `&max_id=${next_max_id}` : ""}`;

    try {
      const response = await axios.get(url, {
        headers: await igHeaders({
          referer: "https://www.instagram.com/",
        }),
        timeout: 30000,
      });

      const users = response.data?.users || [];
      const newIds = users.map((x) => x.pk || x.id);
      ids.push(...newIds);

      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback(ids.length);
      }

      hasMore = Boolean(response.data?.has_more);
      next_max_id = response.data?.next_max_id;

      // Затримка між запитами
      if (hasMore && ids.length < limit) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Захист від зациклення
      if (pageCount > 50) {
        console.warn(`⚠️ Досягнуто максимальну кількість сторінок (${pageCount})`);
        hasMore = false;
      }
    } catch (error) {
      console.error(`❌ Помилка сторінки ${pageCount}:`, error.message);
      hasMore = false;
    }
  }

  return ids.slice(0, limit);
};

export const getAllFollowing = async (id, limit = Infinity, progressCallback = null) => {
  return getAllFollowers(id, limit, progressCallback);
};

export const getReels = async (userId, { after = null, first = 7, pageSize = 2 } = {}) => {
  const body = {
    av: "17841419081024045",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "3a",
    __hs: "20402.HCSV2:instagram_web_pkg.2.1...0",
    dpr: "2",
    __ccg: "GOOD",
    __rev: "1029645341",
    __comet_req: "7",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisProfileReelsTabContentQuery_connection",
    server_timestamps: "true",
    variables: JSON.stringify({
      after: after,
      before: null,
      data: { include_feed_video: true, page_size: pageSize, target_user_id: userId },
      first: first,
      last: null,
    }),
    doc_id: "9905035666198614",
  };

  try {
    const response = await axios.post(
      "https://www.instagram.com/graphql/query",
      new URLSearchParams(body).toString(),
      {
        headers: await igHeaders({
          referer: "https://www.instagram.com/",
          "x-fb-friendly-name": "PolarisProfileReelsTabContentQuery_connection",
          "x-root-field-name": "xdt_api__v1__clips__user__connection_v2",
        }),
        timeout: 30000,
      }
    );

    const edges = response.data?.data?.xdt_api__v1__clips__user__connection_v2?.edges || [];
    return edges
      .reduce((acc, edge) => {
        const media = edge?.node?.media;
        if (!media) return acc;
        if (media.clips_tab_pinned_user_ids?.length) return acc;
        acc.push(media.play_count);
        return acc;
      }, [])
      .slice(0, 7);
  } catch (error) {
    console.error(`❌ Помилка отримання Reels для ${userId}:`, error.message);
    return [];
  }
};

export const getPosts = async (username, { count = 12 } = {}) => {
  const body = {
    av: "17841419081024045",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "6",
    __hs: "20402.HCSV2:instagram_web_pkg.2.1...0",
    dpr: "2",
    __ccg: "MODERATE",
    __rev: "1029645341",
    __comet_req: "7",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisProfilePostsQuery",
    server_timestamps: "true",
    variables: JSON.stringify({
      data: {
        count,
        include_reel_media_seen_timestamp: true,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
      username,
      __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
    }),
    doc_id: "24937007899300943",
  };

  try {
    const response = await axios.post(
      "https://www.instagram.com/graphql/query",
      new URLSearchParams(body).toString(),
      {
        headers: await igHeaders({
          referer: `https://www.instagram.com/${username}/`,
          "x-fb-friendly-name": "PolarisProfilePostsQuery",
          "x-root-field-name": "xdt_api__v1__feed__user_timeline_graphql_connection",
        }),
        timeout: 30000,
      }
    );

    const edges = response.data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges || [];
    return edges.map((e) => e?.node?.caption?.text || "").filter(Boolean).join(", ");
  } catch (error) {
    console.error(`❌ Помилка отримання постів для ${username}:`, error.message);
    return "";
  }
};

export const getUsersByHashtag = async (hashtag, limit = Infinity, progressCallback = null) => {
  const cleanHashtag = hashtag.replace('#', '').trim();
  const userIdsSet = new Set();
  
  console.log(`🔍 Пошук користувачів за хештегом: #${cleanHashtag}`);

  try {
    // Отримуємо HTML сторінки з хештегом
    const response = await axios.get(
      `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanHashtag)}/`,
      {
        headers: await igHeaders({
          referer: `https://www.instagram.com/`,
        }),
        timeout: 30000,
      }
    );

    // Шукаємо JSON дані в HTML
    const html = response.data;
    
    // Спробуємо знайти sharedData
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.*?});/);
    if (sharedDataMatch) {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const mediaArray = sharedData?.entry_data?.TagPage?.[0]?.data?.recent?.sections || 
                        sharedData?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_media?.edges || [];
      
      for (const item of mediaArray) {
        if (item?.media?.owner?.id) {
          userIdsSet.add(item.media.owner.id);
        } else if (item?.node?.owner?.id) {
          userIdsSet.add(item.node.owner.id);
        }
      }
    }

    // Альтернативний метод через API
    if (userIdsSet.size === 0) {
      try {
        const apiResponse = await axios.get(
          `https://www.instagram.com/api/v1/tags/web_info/?tag_name=${encodeURIComponent(cleanHashtag)}`,
          {
            headers: await igHeaders({
              "x-ig-app-id": "936619743392459",
            }),
            timeout: 30000,
          }
        );

        const topMedia = apiResponse.data?.data?.top?.sections || [];
        const recentMedia = apiResponse.data?.data?.recent?.sections || [];
        
        const processSection = (section) => {
          if (section?.layout_content?.medias) {
            section.layout_content.medias.forEach(media => {
              if (media?.media?.user?.pk) {
                userIdsSet.add(media.media.user.pk);
              }
            });
          }
        };

        topMedia.forEach(processSection);
        recentMedia.forEach(processSection);
        
      } catch (apiError) {
        console.error('API метод не спрацював:', apiError.message);
      }
    }

  } catch (criticalError) {
    console.error(`❌ Критична помилка парсингу хештегу #${cleanHashtag}:`, criticalError.message);
  }

  const userIds = Array.from(userIdsSet);
  console.log(`✅ Знайдено ${userIds.length} унікальних користувачів за хештегом #${cleanHashtag}`);
  
  if (progressCallback) {
    progressCallback(userIds.length);
  }
  
  return userIds.slice(0, limit);
};

// =============================
// 🛠️ ДОПОМІЖНІ ФУНКЦІЇ
// =============================

export const formatNumber = (number) => {
  const n = Number(number);
  if (!Number.isFinite(n)) return String(number ?? "");
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 100000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
};

// =============================
// 🗺️ ОСНОВНА ФУНКЦІЯ ОБРОБКИ
// =============================

export const mapFollowers = async ({ ids, limit, min, max, progressCallback = null }) => {
  const result = [];
  const total = Math.min(ids.length, limit || ids.length);
  const idsList = limit ? ids.slice(0, limit) : ids;

  for (let i = 0; i < idsList.length; i++) {
    const id = idsList[i];
    
    if (progressCallback) {
      progressCallback(i + 1, total, `Обробка ID: ${id}`, 'processing');
    }

    try {
      const user = await getUserById(id);
      if (!user) {
        if (progressCallback) {
          progressCallback(i + 1, total, null, 'skipped');
        }
        continue;
      }

      const followerCount = user.follower_count || 0;

      if (followerCount > min && followerCount < max && !user.is_private) {
        const reelsViews = await getReels(id, { pageSize: 20 });
        const posts = await getPosts(user.username, { count: 12 });

        const avg = reelsViews.length > 0
          ? reelsViews.reduce((acc, curr) => acc + Number(curr || 0), 0) / reelsViews.length
          : 0;

        const langs = detectAll(posts).slice(0, 2);

        const payload = {
          username: user.username || 'Не вказано',
          full_name: user.full_name || 'Не вказано',
          follower_count: formatNumber(followerCount),
          rawFollowerCount: followerCount,
          profile_pic_url: user.profile_pic_url || null,
          url: `https://www.instagram.com/${user.username}/`,
          email: extractEmail(user.biography) || extractEmail(posts),
          average: formatNumber(avg.toFixed(2)),
          rawAverage: avg,
          languages: langs.map((l) => `${l.lang} - ${l.accuracy.toFixed(2)}`).join(", "),
          isPrivate: user.is_private || false,
          biography: user.biography || ''
        };

        result.push(payload);
        
        if (progressCallback) {
          progressCallback(i + 1, total, user.username, 'processed');
        }
        
        console.log(`${i + 1}/${total}: ${payload.username} ${payload.email ? `- ${payload.email}` : ""} - ${payload.follower_count} - ${payload.average}`);
      } else {
        if (progressCallback) {
          const status = user.is_private ? 'private' : (followerCount <= min ? 'min_followers' : 'max_followers');
          progressCallback(i + 1, total, user.username, status);
        }
      }
    } catch (error) {
      console.error(`❌ Помилка обробки користувача ${id}:`, error.message);
      if (progressCallback) {
        progressCallback(i + 1, total, null, 'error');
      }
    }

    // Затримка між обробкою користувачів
    if (i < idsList.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Сортування за середніми переглядами Reels
  return result.sort((a, b) => b.rawAverage - a.rawAverage);
};

// Експорт функції для шифрування кукісів
export const encryptCookies = async () => {
  if (!process.env.INSTAGRAM_COOKIE) {
    console.error("❌ Set INSTAGRAM_COOKIE in .env first (only for encryption step).");
    process.exit(1);
  }
  if (!COOKIE_KEY) {
    console.error("❌ Set COOKIE_KEY in .env to encrypt.");
    process.exit(1);
  }
  const enc = encryptText(process.env.INSTAGRAM_COOKIE.trim(), COOKIE_KEY);
  await fs.writeFile(COOKIE_ENC_PATH, enc, "utf8");
  console.log(`✅ cookies encrypted and saved to ${COOKIE_ENC_PATH}`);
  console.log("➡️ Now you can REMOVE INSTAGRAM_COOKIE from .env and keep COOKIE_KEY only.");
  return true;
};