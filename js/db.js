/**
 * Модуль базы данных IndexedDB (TwitchViewerDB).
 * Хранилища:
 *  - viewers: реестр зрителей { username, firstSeen, temporary }
 *  - profiles: кеш данных Twitch-профилей { username, fetchedAt, data }
 */

const dbName = "TwitchViewerDB";
let db;
let newViewersCountTimer = null;

function initDatabase(onSuccess) {
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
        console.log("[IndexedDB] База данных успешно инициализирована");
        if (typeof onSuccess === 'function') {
            onSuccess(db);
        }
    };

    request.onerror = (e) => {
        console.error("[IndexedDB] Ошибка открытия базы данных:", e);
    };

    return request;
}

function updateNewViewersCount() {
    if (!db) return;
    try {
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

        countRequest.onerror = (err) => {
            console.error("[IndexedDB] Ошибка подсчета новых зрителей:", err);
        };
    } catch (err) {
        console.error("[IndexedDB] Исключение при подсчете новых зрителей:", err);
    }
}

function scheduleNewViewersCountUpdate() {
    clearTimeout(newViewersCountTimer);
    newViewersCountTimer = setTimeout(updateNewViewersCount, 250);
}

function getCachedProfiles(usernames) {
    if (!db || !Array.isArray(usernames) || usernames.length === 0) {
        return Promise.resolve(new Map());
    }

    try {
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
        }).catch((err) => {
            console.error("[IndexedDB] Ошибка чтения кеша профилей:", err);
            return new Map();
        });
    } catch (err) {
        console.error("[IndexedDB] Исключение при обращении к кешу профилей:", err);
        return Promise.resolve(new Map());
    }
}

function cacheProfileBatch(usernames, profiles) {
    if (!db || !Array.isArray(usernames) || usernames.length === 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        try {
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
            tx.onerror = () => {
                console.error("[IndexedDB] Ошибка записи пачки профилей:", tx.error);
                reject(tx.error);
            };
            tx.onabort = () => {
                console.warn("[IndexedDB] Транзакция записи пачки профилей прервана:", tx.error);
                reject(tx.error);
            };
        } catch (err) {
            console.error("[IndexedDB] Исключение при сохранении пачки профилей:", err);
            resolve();
        }
    });
}
