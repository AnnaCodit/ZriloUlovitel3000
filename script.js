
const PROFILE_STORE_NAME = "profiles";
const PROFILE_CACHE_TTL = 12 * 60 * 60 * 1000;
const PROFILE_BATCH_SIZE = 50;
const PROFILE_LOAD_DELAY = 500;
const TWITCH_CHANNEL_KEY = "twitchChannel";
const VIEWER_FEED_LIMIT_KEY = "viewerFeedLimit";
const AVATAR_SIZE_KEY = "viewerAvatarSize";
const DEFAULT_AVATAR_SIZE = 150;
const VIEWER_ONLY_NEW_KEY = "viewerOnlyNew";
const DEFAULT_RECENT_VIEWER_DURATION_SEC = 60;

function getRecentViewerDuration() {
    if (typeof RECENT_VIEWER_DURATION_SEC === 'number' && Number.isFinite(RECENT_VIEWER_DURATION_SEC) && RECENT_VIEWER_DURATION_SEC > 0) {
        return RECENT_VIEWER_DURATION_SEC;
    }
    return DEFAULT_RECENT_VIEWER_DURATION_SEC;
}

function getTwitchChannel() {
    const fallback = (typeof MY_TWITCH_CHANNEL === 'string') ? MY_TWITCH_CHANNEL.trim().toLowerCase() : '';
    const stored = readStringSetting(TWITCH_CHANNEL_KEY, fallback);
    return (stored || '').replace(/^#/, '').trim().toLowerCase();
}

function updateChannelDisplay(channel) {
    const el = document.getElementById('channel');
    if (el) {
        el.innerText = channel || '—';
    }
}

let currentTwitchChannel = "";
let twitchClient = null;
let viewerFeedLimit = MAX_LOG_LINES;
let avatarSize = DEFAULT_AVATAR_SIZE;
let onlyNewViewers = false;
let profileLoadTimer = null;
let profileQueueRunning = false;
let profileRefreshRequested = false;
let newViewersCountTimer = null;

currentTwitchChannel = getTwitchChannel();
updateChannelDisplay(currentTwitchChannel);

// --- БАЗА ДАННЫХ (INDEXED DB) ---
const dbName = "TwitchViewerDB";
let db;
const request = indexedDB.open(dbName, 3);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    let store;
    if (!db.objectStoreNames.contains("viewers")) {
        store = db.createObjectStore("viewers", { keyPath: "username" });
    } else {
        store = e.target.transaction.objectStore("viewers");
    }

    if (!store.indexNames.contains("firstSeen")) {
        store.createIndex("firstSeen", "firstSeen", { unique: false });
    }

    if (!db.objectStoreNames.contains(PROFILE_STORE_NAME)) {
        db.createObjectStore(PROFILE_STORE_NAME, { keyPath: "username" });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    logToScreen("IndexedDB connected.", "system");
    // console.log("IndexedDB connected.");

    initializeViewerSettings();
    startTwitchListener(); // Запускаем TMI только когда база готова

    updateNewViewersCount();
    setInterval(updateNewViewersCount, 60000);

    document.getElementById('clearBtn').addEventListener('click', () => {
        const stores = ["viewers", PROFILE_STORE_NAME];
        const tx = db.transaction(stores, "readwrite");
        stores.forEach((storeName) => tx.objectStore(storeName).clear());
        tx.oncomplete = () => {
            logToScreen("Viewers database cleared.", "system");
            updateNewViewersCount();
        };
    });
};

// --- ФУНКЦИЯ ПРОВЕРКИ ---

function updateNewViewersCount() {
    if (!db) return;
    const tx = db.transaction(["viewers"], "readonly");
    const store = tx.objectStore("viewers");
    const index = store.index("firstSeen");
    const range = IDBKeyRange.lowerBound(Date.now() - 24 * 60 * 60 * 1000);
    const countRequest = index.count(range);

    countRequest.onsuccess = () => {
        const count = countRequest.result;
        const el = document.getElementById('new-viewers');
        if (el) el.innerText = count;
    };
}

function scheduleNewViewersCountUpdate() {
    clearTimeout(newViewersCountTimer);
    newViewersCountTimer = setTimeout(updateNewViewersCount, 250);
}

function checkViewer(username, event = '') {
    // если бот - скип
    if (BOTS.includes(username)) return;

    let user_class = 'normal';
    if (COOL_USERS.includes(username)) user_class = 'special';

    const tx = db.transaction(["viewers"], "readwrite");
    const store = tx.objectStore("viewers");
    const req = store.get(username);

    req.onsuccess = () => {
        if (req.result) {
            // Старичок (уже есть в базе)
            if (!onlyNewViewers || COOL_USERS.includes(username)) {
                showTwitchUser("JOIN", `${username}`, user_class);
            }
        } else {
            // Абсолютно новый зритель
            const addRequest = store.add({ username: username, firstSeen: Date.now() });
            addRequest.onsuccess = scheduleNewViewersCountUpdate;
            showTwitchUser("ALERT", `${username}`, "new");
        }
    };
}

// --- ЛОГИКА TMI.JS ---
function startTwitchListener() {
    currentTwitchChannel = getTwitchChannel();
    updateChannelDisplay(currentTwitchChannel);

    if (!currentTwitchChannel) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = 'Укажите канал в настройках';
            statusEl.style.color = 'orange';
        }
        logToScreen("Укажите канал в блоке настроек", "system");
        return;
    }

    if (twitchClient) {
        try {
            twitchClient.disconnect();
        } catch (e) {
            console.warn("Ошибка отключения предыдущего клиента:", e);
        }
    }

    // Настраиваем клиент. identity не нужен, будем анонимами (justinfan)
    twitchClient = new tmi.Client({
        connection: {
            secure: true,
            reconnect: true
        },
        channels: [currentTwitchChannel]
    });

    twitchClient.connect().catch(console.error);

    // Событие подключения
    twitchClient.on('connected', (address, port) => {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = 'Online & Scanning';
            statusEl.style.color = '#00ff41';
        }
        logToScreen(`Connected to ${address}:${port} (${currentTwitchChannel})`, "system");
    });

    // Событие JOIN (Кто-то зашел)
    twitchClient.on('join', (channel, username, self) => {
        if (self) return; // Игнорируем себя (хотя для анонима это редкость)
        checkViewer(username, 'join');
    });

    // (Опционально) Событие MESSAGE - если хочешь ловить тех, кто написал, но join не сработал
    twitchClient.on('message', (channel, tags, message, self) => {
        // tags['username'] - это ник пишущего
        // checkViewer(tags['username'], 'message');
    });
}



// --- ВЫВОД НА ЭКРАН ---
function logToScreen(text, type) {
    const logDiv = document.getElementById('log');
    const line = document.createElement('div');
    line.classList.add('line');
    const time = new Date().toLocaleTimeString('ru-RU');

    line.innerHTML = `
        <div class="datetime">[${time}]</div> 
        <div class="type">[${type}]</div> 
        <div class="text">${text}</div> 
    `;

    logDiv.prepend(line);

    // удаляем старые записи
    while (logDiv.children.length > MAX_LOG_LINES) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

// --- ВЫВОД НА ЭКРАН ---
function showTwitchUser(type, user_name, css_class) {

    const logDiv = document.getElementById('viewers');
    const line = document.createElement('div');
    line.classList.add('line', css_class, 'just-added');
    const normalizedUsername = user_name.toLowerCase();
    line.dataset.username = normalizedUsername;
    const time = new Date().toLocaleTimeString('ru-RU');

    let last_element = logDiv.firstChild;
    if (last_element) last_element.classList.add('separated')

    line.innerHTML = `
        <div class="avatar">
            <img hidden>
        </div>
        <div class="info">
            <a class="nickname" href="https://twitch.tv/${encodeURIComponent(normalizedUsername)}" target="_blank" rel="noopener noreferrer"></a>
            <div class="stats">
                <div class="followers"></div>
                <div class="average_viewers"></div>
            </div>
            <div class="bio"></div>
            <div class="datetime">[${time}]</div> 
            <div class="type">[${type}]</div> 
        </div>
        <div class="timer-bar"></div>
    `;

    const nicknameEl = line.querySelector('.nickname');
    if (nicknameEl) {
        nicknameEl.textContent = user_name;
        nicknameEl.href = `https://twitch.tv/${encodeURIComponent(normalizedUsername)}`;
    }
    const avatarImg = line.querySelector('.avatar img');
    if (avatarImg) avatarImg.alt = user_name;

    const timerBar = line.querySelector('.timer-bar');
    if (timerBar) {
        const recentDuration = getRecentViewerDuration();
        timerBar.style.animationDuration = `${recentDuration}s`;
        timerBar.addEventListener('animationend', () => {
            timerBar.remove();
            line.classList.remove('just-added');
        });
    }

    logDiv.prepend(line);

    // удаляем старые записи
    while (logDiv.children.length > viewerFeedLimit) {
        logDiv.removeChild(logDiv.lastChild);
    }

    scheduleVisibleProfilesLoad();
}

function initializeViewerSettings() {
    const channelInput = document.getElementById('twitchChannel');
    const feedLimitInput = document.getElementById('viewerFeedLimit');
    const avatarSizeInput = document.getElementById('avatarSize');
    const onlyNewInput = document.getElementById('onlyNewViewers');

    currentTwitchChannel = getTwitchChannel();
    viewerFeedLimit = readNumberSetting(VIEWER_FEED_LIMIT_KEY, MAX_LOG_LINES, 1, 500);
    avatarSize = readNumberSetting(AVATAR_SIZE_KEY, DEFAULT_AVATAR_SIZE, 32, 300);
    onlyNewViewers = readBooleanSetting(VIEWER_ONLY_NEW_KEY, false);

    if (channelInput) channelInput.value = currentTwitchChannel;
    if (feedLimitInput) feedLimitInput.value = viewerFeedLimit;
    if (avatarSizeInput) avatarSizeInput.value = avatarSize;
    if (onlyNewInput) onlyNewInput.checked = onlyNewViewers;

    updateChannelDisplay(currentTwitchChannel);
    applyAvatarSize();

    if (channelInput) {
        channelInput.addEventListener('change', () => {
            const newChannel = channelInput.value.replace(/^#/, '').trim().toLowerCase();
            channelInput.value = newChannel;
            if (newChannel === currentTwitchChannel) return;

            const prevChannel = currentTwitchChannel;
            currentTwitchChannel = newChannel;
            writeStringSetting(TWITCH_CHANNEL_KEY, currentTwitchChannel);
            updateChannelDisplay(currentTwitchChannel);

            if (!twitchClient) {
                if (currentTwitchChannel) {
                    startTwitchListener();
                }
            } else if (currentTwitchChannel) {
                if (prevChannel && typeof twitchClient.part === 'function') {
                    twitchClient.part(prevChannel).catch(console.warn);
                }
                if (typeof twitchClient.join === 'function') {
                    twitchClient.join(currentTwitchChannel).then(() => {
                        const statusEl = document.getElementById('status');
                        if (statusEl) {
                            statusEl.innerText = 'Online & Scanning';
                            statusEl.style.color = '#00ff41';
                        }
                        logToScreen(`Переключено на канал: ${currentTwitchChannel}`, "system");
                    }).catch((err) => {
                        console.error("Ошибка переключения канала:", err);
                        logToScreen(`Ошибка переключения на канал: ${currentTwitchChannel}`, "system");
                    });
                }
            } else {
                if (prevChannel && typeof twitchClient.part === 'function') {
                    twitchClient.part(prevChannel).catch(console.warn);
                }
                const statusEl = document.getElementById('status');
                if (statusEl) {
                    statusEl.innerText = 'Укажите канал в настройках';
                    statusEl.style.color = 'orange';
                }
                logToScreen("Канал отключен. Укажите новый канал в настройках", "system");
            }
        });
    }

    if (onlyNewInput) {
        onlyNewInput.addEventListener('change', () => {
            onlyNewViewers = onlyNewInput.checked;
            writeBooleanSetting(VIEWER_ONLY_NEW_KEY, onlyNewViewers);
        });
    }

    if (feedLimitInput) {
        feedLimitInput.addEventListener('input', () => {
            const value = Number.parseInt(feedLimitInput.value, 10);
            if (!Number.isFinite(value)) return;
            viewerFeedLimit = Math.min(500, Math.max(1, value));
            writeNumberSetting(VIEWER_FEED_LIMIT_KEY, viewerFeedLimit);
            trimViewerFeed();
            scheduleVisibleProfilesLoad();
        });

        feedLimitInput.addEventListener('change', () => {
            viewerFeedLimit = clampNumber(feedLimitInput.value, 1, 500, MAX_LOG_LINES);
            feedLimitInput.value = viewerFeedLimit;
            writeNumberSetting(VIEWER_FEED_LIMIT_KEY, viewerFeedLimit);
            trimViewerFeed();
            scheduleVisibleProfilesLoad();
        });
    }

    if (avatarSizeInput) {
        avatarSizeInput.addEventListener('input', () => {
            const value = Number.parseInt(avatarSizeInput.value, 10);
            if (!Number.isFinite(value)) return;
            avatarSize = Math.min(300, Math.max(32, value));
            writeNumberSetting(AVATAR_SIZE_KEY, avatarSize);
            applyAvatarSize();
        });

        avatarSizeInput.addEventListener('change', () => {
            avatarSize = clampNumber(avatarSizeInput.value, 32, 300, DEFAULT_AVATAR_SIZE);
            avatarSizeInput.value = avatarSize;
            writeNumberSetting(AVATAR_SIZE_KEY, avatarSize);
            applyAvatarSize();
        });
    }
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
        console.warn("Не удалось прочитать настройку:", error);
        return fallback;
    }
}

function writeNumberSetting(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        console.warn("Не удалось сохранить настройку:", error);
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
        console.warn("Не удалось прочитать настройку:", error);
        return fallback;
    }
}

function writeStringSetting(key, value) {
    try {
        localStorage.setItem(key, String(value).trim());
    } catch (error) {
        console.warn("Не удалось сохранить настройку:", error);
    }
}

function readBooleanSetting(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null) return fallback;
        return item === "true";
    } catch (error) {
        console.warn("Не удалось прочитать настройку:", error);
        return fallback;
    }
}

function writeBooleanSetting(key, value) {
    try {
        localStorage.setItem(key, String(Boolean(value)));
    } catch (error) {
        console.warn("Не удалось сохранить настройку:", error);
    }
}

function applyAvatarSize() {
    document.documentElement.style.setProperty('--viewer-avatar-size', `${avatarSize}px`);
}

function trimViewerFeed() {
    const logDiv = document.getElementById('viewers');
    while (logDiv.children.length > viewerFeedLimit) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

function scheduleVisibleProfilesLoad() {
    clearTimeout(profileLoadTimer);
    profileLoadTimer = setTimeout(() => {
        profileLoadTimer = null;
        profileRefreshRequested = true;
        processVisibleProfiles();
    }, PROFILE_LOAD_DELAY);
}

function getVisibleUsernames() {
    const usernames = new Set();
    document.querySelectorAll('#viewers .line[data-username]').forEach((line) => {
        usernames.add(line.dataset.username);
    });
    return Array.from(usernames);
}

async function processVisibleProfiles() {
    if (profileQueueRunning) return;
    profileQueueRunning = true;

    try {
        while (profileRefreshRequested) {
            profileRefreshRequested = false;
            const usernames = getVisibleUsernames();
            const cachedProfiles = await getCachedProfiles(usernames);
            const profilesToLoad = [];
            const now = Date.now();

            usernames.forEach((username) => {
                const cached = cachedProfiles.get(username);
                if (cached && now - cached.fetchedAt < PROFILE_CACHE_TTL) {
                    applyProfileToVisibleCards(username, cached.data);
                } else {
                    profilesToLoad.push(username);
                }
            });

            for (let index = 0; index < profilesToLoad.length; index += PROFILE_BATCH_SIZE) {
                const visibleNow = new Set(getVisibleUsernames());
                const batch = profilesToLoad
                    .slice(index, index + PROFILE_BATCH_SIZE)
                    .filter((username) => visibleNow.has(username));

                if (batch.length === 0) continue;

                const [profiles, trackerResults] = await Promise.all([
                    getTwitchUsersData(batch).catch((err) => {
                        console.error("Ошибка IVR:", err);
                        return new Map();
                    }),
                    Promise.all(batch.map((username) => fetchTwitchTrackerSummary(username)))
                ]);

                batch.forEach((username, idx) => {
                    const avgViewers = trackerResults[idx];
                    let profile = profiles.get(username);
                    if (profile) {
                        profile.avgViewers = avgViewers;
                    } else if (avgViewers !== null && avgViewers !== undefined) {
                        profile = { login: username, avgViewers };
                        profiles.set(username, profile);
                    }
                });

                await cacheProfileBatch(batch, profiles);
                profiles.forEach((profile, username) => {
                    applyProfileToVisibleCards(username, profile);
                });
            }
        }
    } catch (error) {
        console.error("Ошибка загрузки данных пользователей:", error);
    } finally {
        profileQueueRunning = false;
        if (profileRefreshRequested) processVisibleProfiles();
    }
}

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

function getCachedProfiles(usernames) {
    if (usernames.length === 0) return Promise.resolve(new Map());

    const tx = db.transaction([PROFILE_STORE_NAME], "readonly");
    const store = tx.objectStore(PROFILE_STORE_NAME);
    const requests = usernames.map((username) => new Promise((resolve, reject) => {
        const getRequest = store.get(username);
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
    }));

    return Promise.all(requests).then((records) => {
        const profiles = new Map();
        records.forEach((record) => {
            if (record) profiles.set(record.username, record);
        });
        return profiles;
    });
}

function cacheProfileBatch(usernames, profiles) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([PROFILE_STORE_NAME], "readwrite");
        const store = tx.objectStore(PROFILE_STORE_NAME);
        const fetchedAt = Date.now();

        usernames.forEach((username) => {
            store.put({
                username: username,
                fetchedAt: fetchedAt,
                data: profiles.get(username) || null
            });
        });

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function getTwitchUsersData(usernames) {
    const url = `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(usernames.join(','))}`;
    let lastError;

    for (let attempt = 0; attempt < 2; attempt++) {
        let timeout;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, { signal: controller.signal });

            if (!response.ok) {
                const error = new Error(`IVR API ответил ${response.status}`);
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

function applyProfileToVisibleCards(username, userData) {
    if (!userData) return;

    document.querySelectorAll('#viewers .line[data-username]').forEach((line) => {
        if (line.dataset.username !== username) return;

        const image = line.querySelector('.avatar img');
        const nickname = line.querySelector('.nickname');
        const followers = line.querySelector('.followers');
        const avgViewersEl = line.querySelector('.average_viewers');
        const bio = line.querySelector('.bio');

        const rawLogin = (userData.login || username || '').toLowerCase();
        if (nickname) {
            nickname.textContent = userData.displayName || userData.login || username;
            if (rawLogin) {
                nickname.href = `https://twitch.tv/${encodeURIComponent(rawLogin)}`;
            }
        }

        if (followers) {
            if (userData.followers !== undefined && userData.followers !== null && Number.isFinite(Number(userData.followers))) {
                const formattedFollowers = Number(userData.followers).toLocaleString('ru-RU');
                followers.innerHTML = `Фоловеров: <span class="count">${formattedFollowers}</span>`;
            } else {
                followers.innerHTML = '';
            }
        }

        if (avgViewersEl) {
            if (userData.avgViewers !== undefined && userData.avgViewers !== null && Number.isFinite(Number(userData.avgViewers)) && Number(userData.avgViewers) > 0) {
                const formattedAvg = Number(userData.avgViewers).toLocaleString('ru-RU');
                avgViewersEl.innerHTML = `Зрителей: <span class="count">${formattedAvg}</span>`;
            } else {
                avgViewersEl.innerHTML = '';
            }
        }

        if (bio) bio.textContent = userData.bio || '';

        if (userData.logo) {
            image.hidden = false;
            image.src = userData.logo;
            image.onerror = () => {
                image.hidden = true;
            };
        }
    });
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

