
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

    // если бот - скип
    if (BOTS.includes(username)) return;

    let user_class = 'normal';
    if (COOL_USERS.includes(username)) user_class = 'special';

    const tx = db.transaction(["viewers"], "readwrite");
    const store = tx.objectStore("viewers");
    const req = store.get(username);

    req.onsuccess = () => {
        if (req.result) {
            // Старичок
            // if (event !== 'message') {
            // }
            logToScreen("JOIN", `${username}`, user_class);
            // logToScreen("JOIN", `${username}`, "old-viewer");
        } else {
            // Новенький
            store.add({ username: username, firstSeen: Date.now() });
            logToScreen("ALERT", `${username}`, "new");
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
        channels: [MY_TWITCH_CHANNEL]
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
        checkViewer(username, 'join');
    });

    // (Опционально) Событие MESSAGE - если хочешь ловить тех, кто написал, но join не сработал
    client.on('message', (channel, tags, message, self) => {
        // tags['username'] - это ник пишущего
        // checkViewer(tags['username'], 'message');
    });
}

// --- ВЫВОД НА ЭКРАН ---
function logToScreen(type, user_name, css_class) {

    const logDiv = document.getElementById('log');
    const line = document.createElement('div');
    line.classList.add('line', css_class, 'just-added');
    const time = new Date().toLocaleTimeString('ru-RU');

    let last_element = logDiv.firstChild;
    if (last_element) last_element.classList.add('separated')

    line.innerHTML = `
        <span class="datetime">[${time}]</span> 
        <span class="type">[${type}]</span> 
        <span class="text">${user_name}</span>
    `;

    logDiv.prepend(line);

    // удаляем старые записи
    while (logDiv.children.length > MAX_LOG_LINES) {

        logDiv.removeChild(logDiv.lastChild);
    }
}
