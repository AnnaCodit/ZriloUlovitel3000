
document.getElementById('channel').innerText = MY_TWITCH_CHANNEL;

// --- БАЗА ДАННЫХ (INDEXED DB) ---
const dbName = "TwitchViewerDB";
let db;
const request = indexedDB.open(dbName, 2);

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
};

request.onsuccess = (e) => {
    db = e.target.result;
    logToScreen("IndexedDB connected.", "system");
    // console.log("IndexedDB connected.");

    startTwitchListener(); // Запускаем TMI только когда база готова

    updateNewViewersCount();
    setInterval(updateNewViewersCount, 60000);

    document.getElementById('clearBtn').addEventListener('click', () => {
        const tx = db.transaction(["viewers"], "readwrite");
        const store = tx.objectStore("viewers");
        const clearReq = store.clear();
        clearReq.onsuccess = () => {
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
            if (SHOW_OLD_VIEWERS || COOL_USERS.includes(username)) {
                showTwitchUser("JOIN", `${username}`, user_class);
            }
            // logToScreen("JOIN", `${username}`, "old-viewer");
        } else {
            // Новенький
            store.add({ username: username, firstSeen: Date.now() });
            showTwitchUser("ALERT", `${username}`, "new");
            updateNewViewersCount();
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
        logToScreen(`Connected to ${address}:${port}`, "system");
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
    const time = new Date().toLocaleTimeString('ru-RU');

    let last_element = logDiv.firstChild;
    if (last_element) last_element.classList.add('separated')

    line.innerHTML = `
        <div class="avatar">
            <img src="https://decapi.me/twitch/avatar/${user_name}">
        </div>
        <div class="info">
            <div class="text">${user_name}</div>
            <div class="datetime">[${time}]</div> 
            <div class="type">[${type}]</div> 
        </div>
    `;

    logDiv.prepend(line);

    // удаляем старые записи
    while (logDiv.children.length > MAX_LOG_LINES) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

async function getTwitchUserData(username) {
    try {
        const response = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${username}`);
        const data = await response.json();

        if (data && data[0]) {
            return data[0].logo; // Возвращает ссылку на картинку
        } else {
            console.error("Пользователь не найден");
            return null;
        }
    } catch (error) {
        console.error("Ошибка запроса:", error);
    }
}

