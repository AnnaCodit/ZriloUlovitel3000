/**
 * Automated Unit Test Suite for ZriloUlovitel3000
 * Tests viewer filtering, cooldown intervals, legacy database compatibility,
 * bot suppression, and settings helpers.
 *
 * Run with: node tests/settings-and-filter.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// --- TEST HARNESS ENVIRONMENT BUILDER ---

function createTestEnvironment(options = {}) {
    const scriptPath = path.join(__dirname, '../script.js');
    const scriptCode = fs.readFileSync(scriptPath, 'utf-8');

    const storage = new Map(Object.entries(options.localStorage || {}));
    const mockLocalStorage = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
        clear: () => storage.clear()
    };

    const viewersDb = new Map();
    if (options.initialViewers) {
        for (const [k, v] of Object.entries(options.initialViewers)) {
            viewersDb.set(k, JSON.parse(JSON.stringify(v)));
        }
    }

    const profilesDb = new Map();
    let transactionCount = 0;

    const mockViewersStore = {
        get(username) {
            const result = viewersDb.has(username)
                ? JSON.parse(JSON.stringify(viewersDb.get(username)))
                : undefined;
            const req = { result, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        },
        put(record) {
            viewersDb.set(record.username, JSON.parse(JSON.stringify(record)));
            const req = { result: record.username, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        },
        add(record) {
            viewersDb.set(record.username, JSON.parse(JSON.stringify(record)));
            const req = { result: record.username, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        },
        index(name) {
            return {
                count(range) {
                    let count = 0;
                    viewersDb.forEach((val) => {
                        if (val.firstSeen !== undefined) count++;
                    });
                    const req = { result: count, onsuccess: null };
                    queueMicrotask(() => {
                        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                    });
                    return req;
                }
            };
        }
    };

    const mockProfilesStore = {
        get(username) {
            const req = { result: profilesDb.get(username), onsuccess: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        },
        put(record) {
            profilesDb.set(record.username, record);
            const req = { result: record.username, onsuccess: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        }
    };

    const mockDb = {
        transaction(stores, mode) {
            transactionCount++;
            return {
                objectStore(name) {
                    if (name === "viewers") return mockViewersStore;
                    if (name === "profiles") return mockProfilesStore;
                    throw new Error(`Unknown objectStore: ${name}`);
                },
                oncomplete: null,
                onerror: null,
                onabort: null
            };
        }
    };

    const domElements = new Map();
    const getMockElement = (id) => {
        if (!domElements.has(id)) {
            domElements.set(id, {
                id,
                innerText: '',
                textContent: '',
                value: '',
                checked: false,
                style: {},
                listeners: {},
                children: [],
                firstChild: null,
                dataset: {},
                addEventListener(event, callback) {
                    if (!this.listeners[event]) this.listeners[event] = [];
                    this.listeners[event].push(callback);
                },
                dispatchEvent(event) {
                    (this.listeners[event] || []).forEach((cb) => cb({ target: this }));
                },
                prepend(child) {
                    this.children.unshift(child);
                    this.firstChild = child;
                },
                appendChild(child) {
                    this.children.push(child);
                    if (!this.firstChild) this.firstChild = child;
                },
                removeChild(child) {
                    const idx = this.children.indexOf(child);
                    if (idx !== -1) this.children.splice(idx, 1);
                    this.firstChild = this.children[0] || null;
                },
                querySelector(selector) {
                    return { textContent: '', alt: '', hidden: false, src: '', onerror: null };
                },
                querySelectorAll() {
                    return [];
                }
            });
        }
        return domElements.get(id);
    };

    let simulatedNow = options.now !== undefined ? options.now : 1700000000000;
    const shownFeedEvents = [];
    let dbOpenRequest;

    const contextObj = {
        MY_TWITCH_CHANNEL: options.channel || 'testchannel',
        BOTS: options.bots || ['streamelements', 'jeetbot', 'nightbot', 'wizebot', 'fossabot', 'frostytoolsdotcom'],
        COOL_USERS: options.coolUsers || ['vip_streamer', 'frazabot'],
        MAX_LOG_LINES: 10,
        document: {
            getElementById: getMockElement,
            querySelectorAll: () => [],
            documentElement: {
                style: {
                    setProperty: () => {}
                }
            },
            createElement: (tag) => {
                const el = {
                    tagName: tag.toUpperCase(),
                    classList: {
                        classes: new Set(),
                        add(...items) {
                            items.forEach((c) => this.classes.add(c));
                        },
                        contains(c) {
                            return this.classes.has(c);
                        }
                    },
                    dataset: {},
                    children: [],
                    firstChild: null,
                    innerHTML: '',
                    querySelector(sel) {
                        return { textContent: '', alt: '', hidden: false, src: '', onerror: null };
                    },
                    prepend(child) {
                        this.children.unshift(child);
                        this.firstChild = child;
                    },
                    appendChild(child) {
                        this.children.push(child);
                        if (!this.firstChild) this.firstChild = child;
                    },
                    removeChild(child) {
                        const idx = this.children.indexOf(child);
                        if (idx !== -1) this.children.splice(idx, 1);
                        this.firstChild = this.children[0] || null;
                    }
                };
                return el;
            }
        },
        localStorage: mockLocalStorage,
        indexedDB: {
            open: () => {
                dbOpenRequest = { onsuccess: null, onupgradeneeded: null, onerror: null };
                return dbOpenRequest;
            }
        },
        IDBKeyRange: {
            lowerBound: () => {}
        },
        tmi: {
            Client: class {
                connect() {
                    return Promise.resolve();
                }
                on() {}
            }
        },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms) => {},
        clearInterval: (id) => {},
        queueMicrotask: (fn) => queueMicrotask(fn),
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        Date: class extends Date {
            constructor(...args) {
                if (args.length === 0) super(simulatedNow);
                else super(...args);
            }
            static now() {
                return simulatedNow;
            }
            toLocaleTimeString() {
                return '12:00:00';
            }
        }
    };

    const ctx = vm.createContext(contextObj);
    vm.runInContext(scriptCode, ctx);

    // Trigger IndexedDB onsuccess to initialize DB and settings
    if (dbOpenRequest && typeof dbOpenRequest.onsuccess === 'function') {
        dbOpenRequest.onsuccess({ target: { result: mockDb } });
    }

    // Intercept showTwitchUser to capture viewer notifications
    const originalShowTwitchUser = ctx.showTwitchUser;
    ctx.showTwitchUser = (type, username, cssClass) => {
        shownFeedEvents.push({
            type,
            username,
            cssClass,
            time: simulatedNow
        });
        return originalShowTwitchUser(type, username, cssClass);
    };

    return {
        ctx,
        viewersDb,
        shownFeedEvents,
        getTransactionCount: () => transactionCount,
        getMockElement,
        localStorage: mockLocalStorage,
        setNow(time) {
            simulatedNow = time;
        },
        advanceHours(hours) {
            simulatedNow += hours * 60 * 60 * 1000;
        },
        advanceMs(ms) {
            simulatedNow += ms;
        },
        async checkViewer(username, event = '') {
            ctx.checkViewer(username, event);
            // Allow microtasks to resolve all IndexedDB callbacks
            await new Promise((resolve) => setImmediate(resolve));
        }
    };
}

// --- TEST SUITE EXECUTION ---

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ==========================================
// TEST 1: Новый зритель
// ==========================================
test("Test 1: Новый зритель -> добавляется в базу с firstSeen и lastSeen, показывается в ленте как ALERT (new)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({ now: t0 });

    await env.checkViewer("alice");

    // 1. Проверяем добавление в базу данных
    const record = env.viewersDb.get("alice");
    assert.ok(record, "Зритель alice должен быть сохранен в IndexedDB");
    assert.strictEqual(record.username, "alice");
    assert.strictEqual(record.firstSeen, t0, "firstSeen должен быть равен текущему времени");
    assert.strictEqual(record.lastSeen, t0, "lastSeen должен быть равен текущему времени");

    // 2. Проверяем вывод в ленту
    assert.strictEqual(env.shownFeedEvents.length, 1, "Должно быть ровно 1 событие в ленте");
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "ALERT",
        username: "alice",
        cssClass: "new",
        time: t0
    });
});

// ==========================================
// TEST 2: Повторный заход через 1 час (кулдаун 12ч)
// ==========================================
test("Test 2: Повторный заход через 1 час при кулдауне 12 ч -> lastSeen обновляется, в ленту НЕ выводится", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        initialViewers: {
            bob: { username: "bob", firstSeen: t0, lastSeen: t0 }
        }
    });

    // Прошел 1 час (интервал < 12ч)
    const t1 = t0 + 1 * 60 * 60 * 1000;
    env.setNow(t1);

    await env.checkViewer("bob");

    // lastSeen должен обновиться
    const record = env.viewersDb.get("bob");
    assert.ok(record);
    assert.strictEqual(record.firstSeen, t0, "firstSeen не должен меняться");
    assert.strictEqual(record.lastSeen, t1, "lastSeen должен обновиться на t1");

    // В ленту ничего не выводится
    assert.strictEqual(env.shownFeedEvents.length, 0, "Событие не должно появляться в ленте до истечения кулдауна");
});

// ==========================================
// TEST 3: Повторный заход через 13 часов при onlyNewViewers = false
// ==========================================
test("Test 3: Повторный заход через 13 часов при кулдауне 12 ч и onlyNewViewers = false -> выводится в ленту как JOIN (normal)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "false" },
        initialViewers: {
            charlie: { username: "charlie", firstSeen: t0, lastSeen: t0 }
        }
    });

    // Прошло 13 часов (интервал >= 12ч)
    const t13 = t0 + 13 * 60 * 60 * 1000;
    env.setNow(t13);

    await env.checkViewer("charlie");

    const record = env.viewersDb.get("charlie");
    assert.strictEqual(record.lastSeen, t13, "lastSeen должен быть обновлен");

    // Должен появиться в ленте как обычный JOIN
    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "JOIN",
        username: "charlie",
        cssClass: "normal",
        time: t13
    });
});

// ==========================================
// TEST 4: Повторный заход через 13 часов при onlyNewViewers = true (обычный зритель)
// ==========================================
test("Test 4: Повторный заход через 13 часов при onlyNewViewers = true и обычном пользователе -> в ленту НЕ выводится", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "true" },
        initialViewers: {
            david: { username: "david", firstSeen: t0, lastSeen: t0 }
        }
    });

    const t13 = t0 + 13 * 60 * 60 * 1000;
    env.setNow(t13);

    await env.checkViewer("david");

    // lastSeen всё равно обновляется
    const record = env.viewersDb.get("david");
    assert.strictEqual(record.lastSeen, t13, "lastSeen должен обновиться даже при скрытии из ленты");

    // Но в ленту не выводится
    assert.strictEqual(env.shownFeedEvents.length, 0, "Обычный зритель не должен отображаться при onlyNewViewers = true");
});

// ==========================================
// TEST 5: Повторный заход через 13 часов при onlyNewViewers = true для COOL_USERS
// ==========================================
test("Test 5: Повторный заход через 13 часов при onlyNewViewers = true для COOL_USERS -> выводится в ленту как JOIN (special)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "true" },
        coolUsers: ["vip_streamer"],
        initialViewers: {
            vip_streamer: { username: "vip_streamer", firstSeen: t0, lastSeen: t0 }
        }
    });

    const t13 = t0 + 13 * 60 * 60 * 1000;
    env.setNow(t13);

    await env.checkViewer("vip_streamer");

    const record = env.viewersDb.get("vip_streamer");
    assert.strictEqual(record.lastSeen, t13);

    // COOL_USERS выводятся всегда, если прошел кулдаун
    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "JOIN",
        username: "vip_streamer",
        cssClass: "special",
        time: t13
    });
});

// ==========================================
// TEST 6: Существующая запись без lastSeen (legacy)
// ==========================================
test("Test 6: Существующая запись без lastSeen (legacy) -> корректно использует firstSeen для расчета интервала и обновляет lastSeen", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "false" },
        initialViewers: {
            legacy_early: { username: "legacy_early", firstSeen: t0 },
            legacy_late: { username: "legacy_late", firstSeen: t0 }
        }
    });

    // 6a: Заход через 1 час (меньше 12ч)
    const t1 = t0 + 1 * 60 * 60 * 1000;
    env.setNow(t1);
    await env.checkViewer("legacy_early");

    assert.strictEqual(env.shownFeedEvents.length, 0, "Не должно выводиться через 1 час после firstSeen");
    const recordEarly = env.viewersDb.get("legacy_early");
    assert.strictEqual(recordEarly.firstSeen, t0);
    assert.strictEqual(recordEarly.lastSeen, t1, "lastSeen должен быть инициализирован значением t1");

    // 6b: Заход через 14 часов (больше 12ч)
    const t14 = t0 + 14 * 60 * 60 * 1000;
    env.setNow(t14);
    await env.checkViewer("legacy_late");

    assert.strictEqual(env.shownFeedEvents.length, 1, "Должно вывестись через 14 часов после firstSeen");
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "JOIN",
        username: "legacy_late",
        cssClass: "normal",
        time: t14
    });
    const recordLate = env.viewersDb.get("legacy_late");
    assert.strictEqual(recordLate.firstSeen, t0);
    assert.strictEqual(recordLate.lastSeen, t14, "lastSeen должен обновиться");
});

// ==========================================
// TEST 7: Боты из списка BOTS
// ==========================================
test("Test 7: Боты из списка BOTS -> игнорируются, не добавляются в базу и не выводятся", async () => {
    const env = createTestEnvironment({
        bots: ["streamelements", "nightbot", "fossabot"]
    });

    const initialTxCount = env.getTransactionCount();

    await env.checkViewer("nightbot");
    await env.checkViewer("streamelements");

    // База не должна содержать ботов
    assert.strictEqual(env.viewersDb.has("nightbot"), false);
    assert.strictEqual(env.viewersDb.has("streamelements"), false);

    // Никаких событий в ленте
    assert.strictEqual(env.shownFeedEvents.length, 0);

    // Никаких транзакций не создавалось
    assert.strictEqual(env.getTransactionCount(), initialTxCount, "Не должно быть обращений к IndexedDB для ботов");
});

// ==========================================
// TEST 8: Чтение/запись настроек и clamp
// ==========================================
test("Test 8: Чтение/запись настроек readBooleanSetting, readNumberSetting и clampNumber", () => {
    const env = createTestEnvironment();
    const ctx = env.ctx;

    // --- 8.1 clampNumber ---
    assert.strictEqual(ctx.clampNumber("50", 1, 100, 10), 50, "Число в диапазоне парсится корректно");
    assert.strictEqual(ctx.clampNumber("-5", 1, 100, 10), 1, "Значение меньше минимума зажимается до min");
    assert.strictEqual(ctx.clampNumber("250", 1, 100, 10), 100, "Значение больше максимума зажимается до max");
    assert.strictEqual(ctx.clampNumber("abc", 1, 100, 10), 10, "Некорректная строка возвращает fallback");
    assert.strictEqual(ctx.clampNumber(null, 1, 100, 10), 10, "null возвращает fallback");
    assert.strictEqual(ctx.clampNumber(undefined, 1, 100, 10), 10, "undefined возвращает fallback");
    assert.strictEqual(ctx.clampNumber("45.8", 1, 100, 10), 45, "Дробная строка парсится как целое число");

    // --- 8.2 readBooleanSetting & writeBooleanSetting ---
    assert.strictEqual(ctx.readBooleanSetting("nonexistent_bool", false), false);
    assert.strictEqual(ctx.readBooleanSetting("nonexistent_bool", true), true);

    ctx.writeBooleanSetting("my_bool", true);
    assert.strictEqual(ctx.readBooleanSetting("my_bool", false), true);

    ctx.writeBooleanSetting("my_bool", false);
    assert.strictEqual(ctx.readBooleanSetting("my_bool", true), false);

    // --- 8.3 readNumberSetting & writeNumberSetting ---
    assert.strictEqual(ctx.readNumberSetting("nonexistent_num", 12, 1, 100), 12);

    ctx.writeNumberSetting("my_num", 24);
    assert.strictEqual(ctx.readNumberSetting("my_num", 12, 1, 100), 24);

    // Проверка зажимания при чтении из localStorage
    ctx.writeNumberSetting("out_of_bounds", 9999);
    assert.strictEqual(ctx.readNumberSetting("out_of_bounds", 10, 1, 50), 50);

    ctx.writeNumberSetting("too_small", -100);
    assert.strictEqual(ctx.readNumberSetting("too_small", 10, 1, 50), 1);
});

// ==========================================
// TEST 9: Дополнительный тест: связывание UI инпутов и localStorage
// ==========================================
test("Test 9: UI инпуты onlyNewViewers и repeatIntervalHours корректно обновляют состояние и сохраняют в localStorage", async () => {
    const env = createTestEnvironment({
        localStorage: {
            viewerOnlyNew: "false",
            viewerRepeatIntervalHours: "12"
        }
    });

    const onlyNewInput = env.getMockElement("onlyNewViewers");
    const repeatIntervalInput = env.getMockElement("repeatIntervalHours");

    // Проверяем начальное заполнение из localStorage
    assert.strictEqual(onlyNewInput.checked, false);
    assert.strictEqual(repeatIntervalInput.value, 12);

    // Симулируем включение чекбокса пользователем
    onlyNewInput.checked = true;
    onlyNewInput.dispatchEvent("change");

    assert.strictEqual(env.localStorage.getItem("viewerOnlyNew"), "true", "Изменение чекбокса сохранилось в localStorage");

    // Симулируем ввод нового интервала (например, 6 часов)
    repeatIntervalInput.value = 6;
    repeatIntervalInput.dispatchEvent("change");

    assert.strictEqual(env.localStorage.getItem("viewerRepeatIntervalHours"), "6", "Новый интервал сохранился в localStorage");

    // Проверяем, что логика checkViewer теперь учитывает новый интервал 6 часов
    const t0 = 1700000000000;
    env.setNow(t0);
    env.viewersDb.set("test_dynamic", { username: "test_dynamic", firstSeen: t0, lastSeen: t0 });

    // Заход через 7 часов (>= 6ч)
    env.advanceHours(7);
    await env.checkViewer("test_dynamic");

    // Так как onlyNewViewers = true, обычный зритель скрыт, но lastSeen обновлен
    assert.strictEqual(env.shownFeedEvents.length, 0);
    assert.strictEqual(env.viewersDb.get("test_dynamic").lastSeen, t0 + 7 * 60 * 60 * 1000);
});

// --- RUNNER ---

async function runTestSuite() {
    console.log("==================================================");
    console.log("  Running ZriloUlovitel3000 Settings & Filter Tests");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (error) {
            console.error(`  [FAIL] ${name}`);
            console.error(`         Error: ${error.message}`);
            if (error.stack) {
                console.error(`         ${error.stack.split("\n").slice(1, 4).join("\n         ")}`);
            }
            failed++;
        }
    }

    console.log("\n--------------------------------------------------");
    console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log("--------------------------------------------------");

    if (failed > 0) {
        process.exit(1);
    }
}

runTestSuite().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
