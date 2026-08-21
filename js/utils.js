/**
 * Вспомогательные утилиты, константы и функции работы с настройками (localStorage).
 */

const PROFILE_STORE_NAME = "profiles";
const PROFILE_CACHE_TTL = 12 * 60 * 60 * 1000;
const PROFILE_BATCH_SIZE = 50;
const PROFILE_LOAD_DELAY = 500;
const TWITCH_CHANNEL_KEY = "twitchChannel";
const VIEWER_FEED_LIMIT_KEY = "viewerFeedLimit";
const AVATAR_SIZE_KEY = "viewerAvatarSize";
const DEFAULT_AVATAR_SIZE = 50;
const VIEWER_ONLY_NEW_KEY = "viewerOnlyNew";
const DEFAULT_RECENT_VIEWER_DURATION_SEC = 60;
const RAID_THRESHOLD_KEY = "raidThreshold";
const DEFAULT_RAID_THRESHOLD = 10;
const RAID_BUFFER_WINDOW_MS = 2000;
const DEFAULT_MIN_FOLLOWERS_THRESHOLD = 10;
const COOL_USERS_KEY = "coolUsers";

function getMinFollowersThreshold() {
    if (typeof MIN_FOLLOWERS_THRESHOLD === 'number' && Number.isFinite(MIN_FOLLOWERS_THRESHOLD) && MIN_FOLLOWERS_THRESHOLD >= 0) {
        return Math.round(MIN_FOLLOWERS_THRESHOLD);
    }
    if (typeof MIN_FOLLOWERS === 'number' && Number.isFinite(MIN_FOLLOWERS) && MIN_FOLLOWERS >= 0) {
        return Math.round(MIN_FOLLOWERS);
    }
    return DEFAULT_MIN_FOLLOWERS_THRESHOLD;
}

function getRecentViewerDuration() {
    if (typeof RECENT_VIEWER_DURATION_SEC === 'number' && Number.isFinite(RECENT_VIEWER_DURATION_SEC) && RECENT_VIEWER_DURATION_SEC > 0) {
        return RECENT_VIEWER_DURATION_SEC;
    }
    return DEFAULT_RECENT_VIEWER_DURATION_SEC;
}

function getRaidThreshold() {
    if (typeof RAID_THRESHOLD === 'number' && Number.isFinite(RAID_THRESHOLD) && RAID_THRESHOLD >= 2) {
        return Math.min(100, Math.max(2, Math.round(RAID_THRESHOLD)));
    }
    return DEFAULT_RAID_THRESHOLD;
}

function getTwitchChannel() {
    const fallback = (typeof MY_TWITCH_CHANNEL === 'string') ? MY_TWITCH_CHANNEL.trim().toLowerCase() : '';
    const stored = readStringSetting(TWITCH_CHANNEL_KEY, fallback);
    return (stored || '').replace(/^#/, '').trim().toLowerCase();
}

function clampNumber(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function readNumberSetting(key, fallback, min, max) {
    try {
        return clampNumber(localStorage.getItem(key), min, max, fallback);
    } catch (error) {
        console.warn("[Settings] Не удалось прочитать числовую настройку:", key, error);
        return fallback;
    }
}

function writeNumberSetting(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        console.warn("[Settings] Не удалось сохранить числовую настройку:", key, error);
    }
}

function readStringSetting(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (typeof item === 'string' && item.trim()) {
            return item.trim();
        }
        return fallback;
    } catch (error) {
        console.warn("[Settings] Не удалось прочитать строковую настройку:", key, error);
        return fallback;
    }
}

function writeStringSetting(key, value) {
    try {
        localStorage.setItem(key, String(value).trim());
    } catch (error) {
        console.warn("[Settings] Не удалось сохранить строковую настройку:", key, error);
    }
}

function readBooleanSetting(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null) return fallback;
        return item === "true";
    } catch (error) {
        console.warn("[Settings] Не удалось прочитать булеву настройку:", key, error);
        return fallback;
    }
}

function writeBooleanSetting(key, value) {
    try {
        localStorage.setItem(key, String(Boolean(value)));
    } catch (error) {
        console.warn("[Settings] Не удалось сохранить булеву настройку:", key, error);
    }
}

function isBot(username) {
    if (!username || typeof BOTS === 'undefined' || !Array.isArray(BOTS)) return false;
    const lower = String(username).trim().toLowerCase();
    return BOTS.some((b) => typeof b === 'string' && b.trim().toLowerCase() === lower);
}

function getCoolUsersRaw() {
    const fallback = (typeof COOL_USERS !== 'undefined' && Array.isArray(COOL_USERS) && COOL_USERS.length > 0)
        ? COOL_USERS.join(', ')
        : '';
    return readStringSetting(COOL_USERS_KEY, fallback);
}

function getCoolUsers() {
    const raw = getCoolUsersRaw();
    if (!raw) return [];
    return raw
        .split(/[\s,]+/)
        .map((u) => u.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
}

function isCoolUser(username) {
    if (!username) return false;
    const lower = String(username).trim().toLowerCase().replace(/^@/, '');
    const list = getCoolUsers();
    return list.includes(lower);
}

function getYearsPlural(years) {
    const mod10 = years % 10;
    const mod100 = years % 100;
    if (mod100 >= 11 && mod100 <= 19) {
        return `${years} лет`;
    }
    if (mod10 === 1) {
        return `${years} год`;
    }
    if (mod10 >= 2 && mod10 <= 4) {
        return `${years} года`;
    }
    return `${years} лет`;
}

function getDaysPlural(days) {
    const mod10 = days % 10;
    const mod100 = days % 100;
    if (mod100 >= 11 && mod100 <= 19) {
        return `${days} дней`;
    }
    if (mod10 === 1) {
        return `${days} день`;
    }
    if (mod10 >= 2 && mod10 <= 4) {
        return `${days} дня`;
    }
    return `${days} дней`;
}

function formatAccountAge(dateVal, nowVal = Date.now()) {
    if (!dateVal) return null;
    const createdDate = new Date(dateVal);
    if (isNaN(createdDate.getTime())) return null;

    const nowDate = new Date(nowVal);
    if (isNaN(nowDate.getTime())) return null;

    let diffMs = nowDate.getTime() - createdDate.getTime();
    if (diffMs < 0) diffMs = 0;

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let years = nowDate.getUTCFullYear() - createdDate.getUTCFullYear();
    let months = nowDate.getUTCMonth() - createdDate.getUTCMonth();
    let days = nowDate.getUTCDate() - createdDate.getUTCDate();

    if (days < 0) {
        months--;
    }
    if (months < 0) {
        years--;
        months += 12;
    }

    const totalMonths = years * 12 + months;

    if (years >= 1) {
        return {
            text: getYearsPlural(years),
            isDanger: false,
            type: 'years',
            value: years
        };
    }

    if (totalMonths >= 1) {
        return {
            text: `${totalMonths} мес.`,
            isDanger: false,
            type: 'months',
            value: totalMonths
        };
    }

    const finalDays = Math.max(0, diffDays);
    return {
        text: getDaysPlural(finalDays),
        isDanger: true,
        type: 'days',
        value: finalDays
    };
}

function formatCreatedAt(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') {
        const match = dateVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return `${match[1]}.${match[2]}.${match[3]}`;
        }
    }
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reloadPage() {
    if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
        window.location.reload();
    } else if (typeof location !== 'undefined' && typeof location.reload === 'function') {
        location.reload();
    }
}
