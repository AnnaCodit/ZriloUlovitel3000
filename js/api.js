/**
 * Модуль интеграции с внешними API (IVR API и TwitchTracker).
 */

/**
 * Получение среднего онлайна зрителей с TwitchTracker API
 * @param {string} username
 * @returns {Promise<number|null>}
 */
async function fetchTwitchTrackerSummary(username) {
    if (!username || typeof username !== 'string') return null;
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser) return null;

    const url = `https://twitchtracker.com/api/channels/summary/${encodeURIComponent(cleanUser)}`;
    let timeout;
    try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 7000);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const data = await response.json();
        if (data && typeof data.avg_viewers === 'number' && Number.isFinite(data.avg_viewers) && data.avg_viewers > 0) {
            return Math.round(data.avg_viewers);
        }
        return null;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Пакетная загрузка профилей пользователей через IVR API v2
 * @param {string[]} usernames
 * @returns {Promise<Map<string, object>>}
 */
async function getTwitchUsersData(usernames) {
    if (!Array.isArray(usernames) || usernames.length === 0) {
        return new Map();
    }

    const url = `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(usernames.join(','))}`;
    let lastError;

    for (let attempt = 0; attempt < 2; attempt++) {
        let timeout;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, { signal: controller.signal });

            if (!response.ok) {
                const error = new Error(`IVR API ответил со статусом ${response.status}`);
                error.retryAfter = Number.parseInt(response.headers.get('Retry-After'), 10);
                throw error;
            }

            const data = await response.json();
            const profiles = new Map();

            if (Array.isArray(data)) {
                data.forEach((profile) => {
                    if (profile && profile.login) {
                        profiles.set(profile.login.toLowerCase(), profile);
                    }
                });
            }

            return profiles;
        } catch (error) {
            lastError = error;
            if (attempt === 0) {
                const delay = Number.isFinite(error.retryAfter) ? error.retryAfter * 1000 : 1000;
                await wait(delay);
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError;
}
