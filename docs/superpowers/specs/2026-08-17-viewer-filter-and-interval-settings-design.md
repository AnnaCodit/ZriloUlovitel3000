# Дизайн-спецификация: Настройки фильтрации зрителей и интервала повторного визита

## Цель
Добавить в панель настроек «Зрилоуловителя 3000» две новые опции:
1. Галочку **«Показывать только новых»** (`onlyNewViewers`): фильтрация ленты для отображения только абсолютно новых зрителей (отсутствующих в базе данных).
2. Настройку **«Повторный визит через»** (`repeatIntervalHours`): интервал в часах (по умолчанию 12 ч), в течение которого повторный заход уже известного зрителя не дублируется в ленте.

Особое правило: пользователи из списка `COOL_USERS` продолжают отображаться при визите даже при активной галочке «Показывать только новых», соблюдая интервал кулдауна повторного появления.

---

## 1. Пользовательский интерфейс (UI)

### 1.1. HTML (`index.html`)
В секцию `<details class="settings">` добавляются новые поля ввода:
```html
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
```

### 1.2. CSS (`style.css`)
Стилизация чекбоксов и выравнивания в панели настроек:
- Для чекбоксов (`input[type="checkbox"]`): аккуратный размер, акцентный курсор, `accent-color: #00ff41` под общий терминальный стиль интерфейса.
- Поддержка горизонтального выравнивания для меток (`.settings label`).

---

## 2. Хранилище данных и настройки

### 2.1. LocalStorage
- `viewerOnlyNew`: строка `"true"` / `"false"`. Значение по умолчанию: `false`.
- `viewerRepeatIntervalHours`: числовое значение (целое число $\ge 1$). Значение по умолчанию: `12`.

Вспомогательные функции в `script.js`:
- `readBooleanSetting(key, fallback)`
- `writeBooleanSetting(key, value)`
- `readNumberSetting(key, fallback, min, max)`
- `writeNumberSetting(key, value)`

### 2.2. IndexedDB (`TwitchViewerDB` / `viewers`)
Схема объекта в хранилище `viewers`:
```javascript
{
    username: string,   // primary key
    firstSeen: number,  // timestamp первого визита
    lastSeen: number    // timestamp последнего захода
}
```
- Для записей, созданных до внедрения этой функции (где отсутствует `lastSeen`), используется фоллбэк: `lastSeen = record.lastSeen || record.firstSeen`.
- При добавлении нового зрителя: `store.add({ username, firstSeen: now, lastSeen: now })`.
- При повторном визите зрителя: `store.put({ ...record, lastSeen: now })`.

---

## 3. Логика обработки зрителей (`checkViewer`)

Алгоритм обработки при получении события `join`:
1. Если имя пользователя находится в списке `BOTS` $\to$ прерываем обработку.
2. Определяем `isCool = COOL_USERS.includes(username)`.
3. Открываем транзакцию чтения/записи `viewers` в IndexedDB и запрашиваем запись по `username`:
   - **Случай A: Зрителя нет в базе (Абсолютно новый)**
     - Добавляем запись `{ username, firstSeen: now, lastSeen: now }`.
     - Вызываем обновление счетчика новых зрителей `scheduleNewViewersCountUpdate()`.
     - Добавляем карточку в ленту: `showTwitchUser("ALERT", username, "new")`.
   - **Случай B: Зритель уже есть в базе (Повторный визит)**
     - Рассчитываем время с прошлого захода: `timeSinceLastSeen = now - (record.lastSeen || record.firstSeen)`.
     - Порог в миллисекундах: `thresholdMs = repeatIntervalHours * 60 * 60 * 1000`.
     - Записываем в базу актуальное время `lastSeen = now`: `store.put({ ...record, lastSeen: now })`.
     - Проверяем условие вывода в ленту:
       - Если `timeSinceLastSeen < thresholdMs` $\to$ зритель зашел повторно раньше кулдауна (не выводим в ленту).
       - Если `timeSinceLastSeen >= thresholdMs`:
         - Если `isCool` $\to$ выводим в ленту: `showTwitchUser("JOIN", username, "special")`.
         - Иначе если `!onlyNewViewers` $\to$ выводим в ленту: `showTwitchUser("JOIN", username, "normal")`.
         - Иначе (если включен `onlyNewViewers` и пользователь не в `COOL_USERS`) $\to$ не выводим в ленту.

---

## 4. Обратная совместимость и крайние случаи
1. **Отсутствие `lastSeen` в существующих записях**:
   Обрабатывается конструкцией `record.lastSeen || record.firstSeen`.
2. **Невалидный ввод в поле часов**:
   Если пользователь вводит `0`, отрицательное число или пустую строку, значение нормализуется (clamp к минимуму `1` или дефолту `12`).
3. **Обновление настроек в реальном времени**:
   При переключении галочки или изменении часов значения мгновенно обновляют переменные в памяти и сохраняются в `localStorage`.
