
// --- БАЗА ДАННЫХ (INDEXED DB) ---
const dbName = "TwitchViewerDB";
let db;
const request = indexedDB.open(dbName, 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("viewers")) {
        db.createObjectStore("viewers", { keyPath: "username" });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    logToScreen("DB", "IndexedDB connected.", "system");
    startTwitchListener(); // Запускаем TMI только когда база готова
    document.getElementById('clearBtn').addEventListener('click', () => {
        const tx = db.transaction(["viewers"], "readwrite");
        const store = tx.objectStore("viewers");
        const clearReq = store.clear();
        clearReq.onsuccess = () => {
            logToScreen("DB", "Viewers database cleared.", "system");
        };
    });
};

// --- ФУНКЦИЯ ПРОВЕРКИ ---

function checkViewer(username, event = '') {
    if (BOTS.includes(username)) return;

    const tx = db.transaction(["viewers"], "readwrite");
    const store = tx.objectStore("viewers");
    const req = store.get(username);

    req.onsuccess = () => {
        if (req.result) {
            // Старичок
            if (event !== 'message') {
                logToScreen("JOIN", `${username}`, "old-viewer");
            }
        } else {
            // Новенький
            store.add({ username: username, firstSeen: Date.now() });
            logToScreen("ALERT", `>>> NEW VIEWER: ${username} <<<`, "new-viewer");
        }
    };
}

// --- ЛОГИКА TMI.JS ---
function startTwitchListener() {
    // Настраиваем клиент. identity не нужен, будем анонимами (justinfan)
    const client = new tmi.Client({
        connection: {
            secure: true,
            reconnect: true
        },
        channels: [MY_CHANNEL]
    });

    client.connect().catch(console.error);

    // Событие подключения
    client.on('connected', (address, port) => {
        document.getElementById('status').innerText = 'Online & Scanning';
        document.getElementById('status').style.color = '#00ff41';
        logToScreen("SYS", `Connected to ${address}:${port}`, "system");
    });

    // Событие JOIN (Кто-то зашел)
    client.on('join', (channel, username, self) => {
        if (self) return; // Игнорируем себя (хотя для анонима это редкость)
        checkViewer(username);
    });

    // (Опционально) Событие MESSAGE - если хочешь ловить тех, кто написал, но join не сработал
    client.on('message', (channel, tags, message, self) => {
        // tags['username'] - это ник пишущего
        checkViewer(tags['username'], 'message');
    });
}

// --- ВЫВОД НА ЭКРАН ---
function logToScreen(type, text, cssClass) {
    const logDiv = document.getElementById('log');
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString('ru-RU');
    line.innerHTML = `<span style="opacity:0.5">[${time}]</span> [${type}] <span class="${cssClass}">${text}</span>`;
    logDiv.appendChild(line);
    logDiv.scrollTop = logDiv.scrollHeight;
}
