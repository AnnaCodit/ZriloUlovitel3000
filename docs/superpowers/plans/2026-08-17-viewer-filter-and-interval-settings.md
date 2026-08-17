# Implementation Plan: Настройки фильтрации зрителей и интервала повторного визита

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить чекбокс «Показывать только новых» и поле «Повторный визит через (ч)» в панель настроек, реализовать сохранение в localStorage, поддержку `lastSeen` в IndexedDB и фильтрацию зрителей в ленте с сохранением отображения `COOL_USERS`.

**Architecture:** Настройки сохраняются в `localStorage` и читаются при старте. В IndexedDB записи зрителей дополняются полем `lastSeen`. При событии `join` функция `checkViewer` проверяет интервал `lastSeen` и флаг `onlyNewViewers`, выводя в ленту только подходящих зрителей.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3, IndexedDB API, Web Storage API.

## Global Constraints
- `viewerOnlyNew`: ключ в localStorage, boolean, по умолчанию `false`.
- `viewerRepeatIntervalHours`: ключ в localStorage, number $\ge 1$, по умолчанию `12`.
- Пользователи из `COOL_USERS` выводятся в ленту при повторном визите, если прошло $\ge$ `repeatIntervalHours` часов, даже при включенном `onlyNewViewers`.
- Для записей без `lastSeen` в IndexedDB использовать фоллбэк `record.lastSeen || record.firstSeen`.
- Не изменять логику счетчика «Новеньких за 24 часа».

---

### Task 1: Разметка и стили настроек в UI

**Files:**
- Modify: `index.html:19-33`
- Modify: `style.css:40-77`

**Interfaces:**
- HTML Elements: `<input id="onlyNewViewers" type="checkbox">`, `<input id="repeatIntervalHours" type="number" min="1" step="1">`

- [ ] **Step 1: Обновить `index.html`**

Добавить чекбокс и поле интервала в `<details class="settings">`:
```html
            <details class="settings">
                <summary>Настройки</summary>
                <label>
                    Показывать только новых
                    <input id="onlyNewViewers" type="checkbox">
                </label>
                <label>
                    Повторный визит через
                    <span class="input-with-unit">
                        <input id="repeatIntervalHours" type="number" min="1" step="1">
                        <span>ч</span>
                    </span>
                </label>
                <label>
                    Ников в ленте
                    <input id="viewerFeedLimit" type="number" min="1" max="500" step="1">
                </label>
                <label>
                    Размер аватарки
                    <span class="input-with-unit">
                        <input id="avatarSize" type="number" min="32" max="300" step="1">
                        <span>px</span>
                    </span>
                </label>
            </details>
```

- [ ] **Step 2: Обновить `style.css`**

Добавить стилизацию для чекбокса и уточнить стили для инпутов в настройках:
```css
.settings input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #00ff41;
    cursor: pointer;
}
```

- [ ] **Step 3: Проверить отображение элементов в DOM**

Убедиться, что элементы с id `onlyNewViewers` и `repeatIntervalHours` присутствуют в HTML-файле.

- [ ] **Step 4: Зафиксировать изменения**

```bash
git add index.html style.css
git commit -m "feat(ui): add only-new-viewers checkbox and repeat-interval input to settings"
```

---

### Task 2: Инициализация и сохранение настроек в JavaScript

**Files:**
- Modify: `script.js:8-18, 210-276`

**Interfaces:**
- Variables: `let onlyNewViewers = false;`, `let repeatIntervalHours = 12;`
- Keys: `VIEWER_ONLY_NEW_KEY = "viewerOnlyNew"`, `VIEWER_REPEAT_INTERVAL_KEY = "viewerRepeatIntervalHours"`
- Functions: `readBooleanSetting(key, fallback)`, `writeBooleanSetting(key, value)`

- [ ] **Step 1: Добавить константы и переменные состояния в `script.js`**

В начале `script.js`:
```javascript
const VIEWER_ONLY_NEW_KEY = "viewerOnlyNew";
const VIEWER_REPEAT_INTERVAL_KEY = "viewerRepeatIntervalHours";
const DEFAULT_REPEAT_INTERVAL_HOURS = 12;

let onlyNewViewers = false;
let repeatIntervalHours = DEFAULT_REPEAT_INTERVAL_HOURS;
```

- [ ] **Step 2: Реализовать функции чтения/записи булевых настроек**

Добавить хелперы:
```javascript
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
```

- [ ] **Step 3: Расширить `initializeViewerSettings()`**

Связать DOM-элементы `onlyNewViewers` и `repeatIntervalHours` с состоянием и событиями (`change`, `input`):
```javascript
function initializeViewerSettings() {
    const feedLimitInput = document.getElementById('viewerFeedLimit');
    const avatarSizeInput = document.getElementById('avatarSize');
    const onlyNewInput = document.getElementById('onlyNewViewers');
    const repeatIntervalInput = document.getElementById('repeatIntervalHours');

    viewerFeedLimit = readNumberSetting(VIEWER_FEED_LIMIT_KEY, MAX_LOG_LINES, 1, 500);
    avatarSize = readNumberSetting(AVATAR_SIZE_KEY, DEFAULT_AVATAR_SIZE, 32, 300);
    onlyNewViewers = readBooleanSetting(VIEWER_ONLY_NEW_KEY, false);
    repeatIntervalHours = readNumberSetting(VIEWER_REPEAT_INTERVAL_KEY, DEFAULT_REPEAT_INTERVAL_HOURS, 1, Number.MAX_SAFE_INTEGER);

    feedLimitInput.value = viewerFeedLimit;
    avatarSizeInput.value = avatarSize;
    if (onlyNewInput) onlyNewInput.checked = onlyNewViewers;
    if (repeatIntervalInput) repeatIntervalInput.value = repeatIntervalHours;

    applyAvatarSize();

    if (onlyNewInput) {
        onlyNewInput.addEventListener('change', () => {
            onlyNewViewers = onlyNewInput.checked;
            writeBooleanSetting(VIEWER_ONLY_NEW_KEY, onlyNewViewers);
        });
    }

    if (repeatIntervalInput) {
        repeatIntervalInput.addEventListener('input', () => {
            const value = Number.parseInt(repeatIntervalInput.value, 10);
            if (!Number.isFinite(value) || value < 1) return;
            repeatIntervalHours = value;
            writeNumberSetting(VIEWER_REPEAT_INTERVAL_KEY, repeatIntervalHours);
        });

        repeatIntervalInput.addEventListener('change', () => {
            repeatIntervalHours = clampNumber(repeatIntervalInput.value, 1, Number.MAX_SAFE_INTEGER, DEFAULT_REPEAT_INTERVAL_HOURS);
            repeatIntervalInput.value = repeatIntervalHours;
            writeNumberSetting(VIEWER_REPEAT_INTERVAL_KEY, repeatIntervalHours);
        });
    }

    // Обработчики feedLimitInput и avatarSizeInput остаются без изменений...
```

- [ ] **Step 4: Зафиксировать изменения**

```bash
git add script.js
git commit -m "feat(settings): support onlyNewViewers and repeatIntervalHours in script.js"
```

---

### Task 3: Обновление логики `checkViewer` и работы с IndexedDB

**Files:**
- Modify: `script.js:86-115`

**Interfaces:**
- Object Store `viewers`: `{ username: string, firstSeen: number, lastSeen: number }`
- Logic in `checkViewer(username, event)`

- [ ] **Step 1: Обновить логику добавления нового зрителя и обновления существующего**

Изменить `checkViewer` в `script.js`:
```javascript
function checkViewer(username, event = '') {
    // если бот - скип
    if (BOTS.includes(username)) return;

    const isCool = COOL_USERS.includes(username);
    const user_class = isCool ? 'special' : 'normal';
    const now = Date.now();

    const tx = db.transaction(["viewers"], "readwrite");
    const store = tx.objectStore("viewers");
    const req = store.get(username);

    req.onsuccess = () => {
        if (req.result) {
            // Зритель уже есть в базе
            const record = req.result;
            const previousSeen = record.lastSeen || record.firstSeen || 0;
            const timeSinceLastSeen = now - previousSeen;
            const thresholdMs = repeatIntervalHours * 60 * 60 * 1000;

            // Обновляем lastSeen в базе
            record.lastSeen = now;
            store.put(record);

            if (timeSinceLastSeen >= thresholdMs) {
                if (isCool) {
                    showTwitchUser("JOIN", `${username}`, user_class);
                } else if (!onlyNewViewers) {
                    showTwitchUser("JOIN", `${username}`, user_class);
                }
            }
        } else {
            // Абсолютно новый зритель
            const addRequest = store.add({
                username: username,
                firstSeen: now,
                lastSeen: now
            });
            addRequest.onsuccess = scheduleNewViewersCountUpdate;
            showTwitchUser("ALERT", `${username}`, "new");
        }
    };
}
```

- [ ] **Step 2: Зафиксировать изменения**

```bash
git add script.js
git commit -m "feat(viewer): track lastSeen and apply onlyNewViewers filter and repeat interval"
```

---

### Task 4: Автоматизированное тестирование логики и проверка

**Files:**
- Create: `tests/settings-and-filter.test.js`

- [ ] **Step 1: Написать модульный тест для проверки логики фильтрации и кулдауна**

Создать `tests/settings-and-filter.test.js` для эмуляции поведения `checkViewer`:
- Тест 1: Новый зритель $\to$ добавляется в базу, показывается как `"ALERT", "new"`.
- Тест 2: Повторный заход через 1 час при кулдауне 12 ч $\to$ `lastSeen` обновляется, в ленту НЕ выводится.
- Тест 3: Повторный заход через 13 часов при кулдауне 12 ч и `onlyNewViewers = false` $\to$ выводится как `"JOIN", "normal"`.
- Тест 4: Повторный заход через 13 часов при `onlyNewViewers = true` и обычном пользователе $\to$ в ленту НЕ выводится.
- Тест 5: Повторный заход через 13 часов при `onlyNewViewers = true` для `COOL_USERS` $\to$ выводится как `"JOIN", "special"`.

- [ ] **Step 2: Запустить тест через Node.js**

Run: `node tests/settings-and-filter.test.js`
Expected: Все тесты пройдены без ошибок (exit code 0).

- [ ] **Step 3: Зафиксировать тест**

```bash
git add tests/settings-and-filter.test.js
git commit -m "test: add unit tests for viewer filter and cooldown logic"
```
