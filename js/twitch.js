/**
 * Модуль интеграции с Twitch IRC (TMI.js), фильтрации событий JOIN и защиты от рейдов.
 */

let twitchClient = null;
let joinBuffer = [];
let joinBufferTimer = null;

function processViewer(cleanUsername, event = '') {
    if (!db || !cleanUsername) return;

    let user_class = 'normal';
    if (isCoolUser(cleanUsername)) user_class = 'special';

    try {
        const tx = db.transaction(["viewers"], "readwrite");
        const store = tx.objectStore("viewers");
        const req = store.get(cleanUsername);

        req.onsuccess = () => {
            const viewer = req.result;
            if (viewer && viewer.temporary) {
                // Зритель был записан во время рейда, а теперь зашел индивидуально ("по-настоящему")
                viewer.firstSeen = Date.now();
                delete viewer.temporary;
                const putRequest = store.put(viewer);
                putRequest.onsuccess = scheduleNewViewersCountUpdate;
                showTwitchUser("ALERT", cleanUsername, "new");
            } else if (viewer) {
                // Старичок (уже есть в базе)
                if (!onlyNewViewers || isCoolUser(cleanUsername)) {
                    showTwitchUser("JOIN", cleanUsername, user_class);
                }
            } else {
                // Абсолютно новый зритель
                const addRequest = store.add({ username: cleanUsername, firstSeen: Date.now() });
                addRequest.onsuccess = scheduleNewViewersCountUpdate;
                showTwitchUser("ALERT", cleanUsername, "new");
            }
        };

        req.onerror = (err) => {
            console.error("[Twitch/DB] Ошибка при проверке зрителя:", cleanUsername, err);
        };
    } catch (err) {
        console.error("[Twitch/DB] Исключение при проверке зрителя:", cleanUsername, err);
    }
}

function checkViewer(username, event = '') {
    if (!username || typeof username !== 'string') return;
    const cleanUsername = username.trim().toLowerCase();

    // если бот - скип
    if (isBot(cleanUsername)) return;

    processViewer(cleanUsername, event);
}

function enqueueViewer(username, event = 'join') {
    if (!username || typeof username !== 'string') return;
    const cleanUsername = username.trim().toLowerCase();

    // если бот - скип
    if (isBot(cleanUsername)) return;

    joinBuffer.push(cleanUsername);

    if (!joinBufferTimer) {
        joinBufferTimer = setTimeout(flushJoinBuffer, RAID_BUFFER_WINDOW_MS);
    }
}

function flushJoinBuffer() {
    clearTimeout(joinBufferTimer);
    joinBufferTimer = null;
    if (joinBuffer.length === 0) return;

    const batch = Array.from(new Set(joinBuffer));
    joinBuffer = [];

    processJoinBatch(batch);
}

function processJoinBatch(batch) {
    if (!db || !batch || batch.length === 0) return;

    const uniqueBatch = Array.from(new Set(batch));

    try {
        const tx = db.transaction(["viewers"], "readonly");
        const store = tx.objectStore("viewers");

        const records = new Map();
        let pending = uniqueBatch.length;

        const onCheckComplete = () => {
            const newViewers = [];
            const oldViewers = [];

            uniqueBatch.forEach((username) => {
                const viewer = records.get(username);
                // Зритель считается старичком, если он уже есть в базе и не является временным
                if (viewer && !viewer.temporary) {
                    oldViewers.push(username);
                } else {
                    newViewers.push(username);
                }
            });

            if (newViewers.length >= raidThreshold) {
                // Наплыв рейда: порог превышен именно новыми зрителями
                processRaidBatch(newViewers);
                // Старичков из этой же пачки обрабатываем в штатном режиме
                oldViewers.forEach((username) => {
                    processViewer(username, 'join');
                });
            } else {
                // Новых зрителей меньше порога рейда — обрабатываем всех штатно
                uniqueBatch.forEach((username) => {
                    processViewer(username, 'join');
                });
            }
        };

        uniqueBatch.forEach((username) => {
            const req = store.get(username);
            req.onsuccess = () => {
                records.set(username, req.result);
                pending--;
                if (pending === 0) {
                    onCheckComplete();
                }
            };
            req.onerror = () => {
                records.set(username, undefined);
                pending--;
                if (pending === 0) {
                    onCheckComplete();
                }
            };
        });
    } catch (err) {
        console.error("[Twitch/DB] Ошибка при проверке пачки зрителей:", err);
        uniqueBatch.forEach((username) => {
            processViewer(username, 'join');
        });
    }
}

function processRaidBatch(batch) {
    if (!db || !batch || batch.length === 0) return;

    try {
        const tx = db.transaction(["viewers"], "readwrite");
        const store = tx.objectStore("viewers");

        batch.forEach((cleanUsername) => {
            const req = store.get(cleanUsername);
            req.onsuccess = () => {
                const viewer = req.result;
                if (!viewer) {
                    // Новый зритель при рейде: сохраняем как временного без firstSeen
                    store.add({ username: cleanUsername, temporary: true });
                }
            };
        });
    } catch (err) {
        console.error("[Twitch/Raid] Ошибка сохранения рейдеров в БД:", err);
    }

    showRaidAlert(batch.length);
}

function startTwitchListener() {
    currentTwitchChannel = getTwitchChannel();
    updateChannelDisplay(currentTwitchChannel);

    if (!currentTwitchChannel) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = 'Укажите канал в настройках';
            statusEl.style.color = 'orange';
        }
        return;
    }

    if (twitchClient) {
        try {
            twitchClient.disconnect();
        } catch (e) {
            console.warn("[Twitch] Предупреждение при отключении предыдущего клиента:", e);
        }
    }

    // Настраиваем клиент. identity не нужен, подключаемся анонимно (justinfan)
    if (typeof tmi === 'undefined' || !tmi.Client) {
        console.error("[Twitch] Библиотека tmi.js не найдена");
        return;
    }

    twitchClient = new tmi.Client({
        connection: {
            secure: true,
            reconnect: true
        },
        channels: [currentTwitchChannel]
    });

    twitchClient.connect().catch((err) => {
        console.error("[Twitch] Ошибка подключения к IRC Twitch:", err);
    });

    // Событие успешного подключения
    twitchClient.on('connected', (address, port) => {
        console.log(`[Twitch] Подключено к каналу #${currentTwitchChannel}`);
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = 'Online & Scanning';
            statusEl.style.color = '#00ff41';
        }
    });

    // Событие JOIN (Кто-то зашел в чат)
    twitchClient.on('join', (channel, username, self) => {
        if (self) return; // Игнорируем себя
        enqueueViewer(username, 'join');
    });
}
