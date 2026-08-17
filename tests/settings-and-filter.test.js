/**
 * Automated Unit Test Suite for ZriloUlovitel3000
 * Tests viewer filtering (onlyNewViewers toggle), COOL_USERS VIP bypass,
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
        objectStoreNames: {
            contains: (name) => name === "viewers" || name === "profiles"
        },
        transaction(stores, mode) {
            transactionCount++;
            return {
                objectStore(storeName) {
                    if (storeName === "viewers") return mockViewersStore;
                    if (storeName === "profiles") return mockProfilesStore;
                    throw new Error(`Unknown store: ${storeName}`);
                }
            };
        }
    };

    const domElements = new Map();
    function getOrCreateElement(id) {
        if (!domElements.has(id)) {
            const listeners = new Map();
            domElements.set(id, {
                id,
                value: "",
                checked: false,
                innerText: "",
                textContent: "",
                style: {},
                dataset: {},
                classList: {
                    add: () => {},
                    remove: () => {},
                    contains: () => false
                },
                children: [],
                addEventListener(event, fn) {
                    if (!listeners.has(event)) listeners.set(event, []);
                    listeners.get(event).push(fn);
                },
                dispatchEvent(event) {
                    const list = listeners.get(event) || [];
                    list.forEach((fn) => fn({ target: this }));
                },
                prepend(el) {
                    this.children.unshift(el);
                },
                removeChild(el) {
                    const idx = this.children.indexOf(el);
                    if (idx !== -1) this.children.splice(idx, 1);
                },
                querySelector() {
                    return getOrCreateElement("mock_sub_" + Math.random());
                },
                querySelectorAll() {
                    return [];
                }
            });
        }
        return domElements.get(id);
    }

    const shownFeedEvents = [];
    const shownLogEvents = [];
    let currentTime = options.now || Date.now();

    let lastOpenReq = null;
    const sandbox = {
        MY_TWITCH_CHANNEL: options.channel || 'testchannel',
        BOTS: options.bots || ['streamelements', 'nightbot', 'fossabot'],
        COOL_USERS: options.coolUsers || ['farostg', 'annacodit'],
        MAX_LOG_LINES: 50,
        localStorage: mockLocalStorage,
        document: {
            getElementById: (id) => getOrCreateElement(id),
            querySelector: (sel) => getOrCreateElement("mock_sel_" + sel),
            querySelectorAll: () => [],
            createElement: (tag) => getOrCreateElement(`elem_${tag}_${Math.random()}`),
            documentElement: {
                style: {
                    setProperty: () => {}
                }
            }
        },
        Date: class extends Date {
            constructor(...args) {
                if (args.length === 0) super(currentTime);
                else super(...args);
            }
            static now() {
                return currentTime;
            }
        },
        tmi: {
            Client: function () {
                return {
                    connect: () => Promise.resolve(),
                    on: () => {}
                };
            }
        },
        indexedDB: {
            open: () => {
                lastOpenReq = {
                    onupgradeneeded: null,
                    onsuccess: null,
                    onerror: null
                };
                return lastOpenReq;
            }
        },
        IDBKeyRange: {
            lowerBound: (val) => ({ lower: val })
        },
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: () => 123,
        clearInterval: () => {},
        queueMicrotask,
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        }
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptCode, context);

    if (lastOpenReq && typeof lastOpenReq.onsuccess === 'function') {
        lastOpenReq.onsuccess({ target: { result: mockDb } });
    }
    transactionCount = 0;

    context.showTwitchUser = function (type, username, cssClass) {
        shownFeedEvents.push({
            type,
            username,
            cssClass,
            time: currentTime
        });
    };
    context.logToScreen = function (text, type) {
        shownLogEvents.push({ text, type, time: currentTime });
    };

    context.initializeViewerSettings();

    return {
        ctx: context,
        viewersDb,
        profilesDb,
        shownFeedEvents,
        shownLogEvents,
        localStorage: mockLocalStorage,
        getMockElement: (id) => getOrCreateElement(id),
        getTransactionCount: () => transactionCount,
        setNow(ts) {
            currentTime = ts;
        },
        checkViewer(username, event = '') {
            return new Promise((resolve) => {
                context.checkViewer(username, event);
                setTimeout(resolve, 5);
            });
        }
    };
}

// --- TEST SUITE ---

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ==========================================
// TEST 1: Новый зритель
// ==========================================
test("Test 1: Новый зритель -> добавляется в базу с firstSeen, выводится в ленту как ALERT (new)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({ now: t0 });

    assert.strictEqual(env.viewersDb.has("alice"), false);

    await env.checkViewer("alice");

    // Проверяем запись в IndexedDB
    assert.strictEqual(env.viewersDb.has("alice"), true);
    const record = env.viewersDb.get("alice");
    assert.strictEqual(record.username, "alice");
    assert.strictEqual(record.firstSeen, t0);

    // Проверяем вывод в ленту
    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "ALERT",
        username: "alice",
        cssClass: "new",
        time: t0
    });
});

// ==========================================
// TEST 2: Повторный заход при onlyNewViewers = false
// ==========================================
test("Test 2: Повторный заход при onlyNewViewers = false -> выводится в ленту как JOIN (normal)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "false" },
        initialViewers: {
            bob: { username: "bob", firstSeen: t0 }
        }
    });

    await env.checkViewer("bob");

    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "JOIN",
        username: "bob",
        cssClass: "normal",
        time: t0
    });
});

// ==========================================
// TEST 3: Повторный заход при onlyNewViewers = true
// ==========================================
test("Test 3: Повторный заход при onlyNewViewers = true (обычный зритель) -> НЕ выводится в ленту", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "true" },
        initialViewers: {
            charlie: { username: "charlie", firstSeen: t0 }
        }
    });

    await env.checkViewer("charlie");

    // В ленту не выводится
    assert.strictEqual(env.shownFeedEvents.length, 0, "Обычный зритель не должен отображаться при onlyNewViewers = true");
});

// ==========================================
// TEST 4: Повторный заход при onlyNewViewers = true для COOL_USERS
// ==========================================
test("Test 4: Повторный заход при onlyNewViewers = true для COOL_USERS -> выводится в ленту как JOIN (special)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        localStorage: { viewerOnlyNew: "true" },
        coolUsers: ["vip_streamer"],
        initialViewers: {
            vip_streamer: { username: "vip_streamer", firstSeen: t0 }
        }
    });

    await env.checkViewer("vip_streamer");

    // COOL_USERS выводятся всегда
    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "JOIN",
        username: "vip_streamer",
        cssClass: "special",
        time: t0
    });
});

// ==========================================
// TEST 5: Боты из списка BOTS
// ==========================================
test("Test 5: Боты из списка BOTS -> игнорируются, не добавляются в базу и не выводятся", async () => {
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

    // Никаких транзакций к IndexedDB
    assert.strictEqual(env.getTransactionCount(), initialTxCount, "Не должно быть обращений к IndexedDB для ботов");
});

// ==========================================
// TEST 6: Чтение/запись настроек и clamp
// ==========================================
test("Test 6: Чтение/запись настроек readBooleanSetting, readNumberSetting и clampNumber", () => {
    const env = createTestEnvironment();
    const ctx = env.ctx;

    // --- 6.1 clampNumber ---
    assert.strictEqual(ctx.clampNumber("50", 1, 100, 10), 50, "Число в диапазоне парсится корректно");
    assert.strictEqual(ctx.clampNumber("-5", 1, 100, 10), 1, "Значение меньше минимума зажимается до min");
    assert.strictEqual(ctx.clampNumber("250", 1, 100, 10), 100, "Значение больше максимума зажимается до max");
    assert.strictEqual(ctx.clampNumber("abc", 1, 100, 10), 10, "Некорректная строка возвращает fallback");
    assert.strictEqual(ctx.clampNumber(null, 1, 100, 10), 10, "null возвращает fallback");
    assert.strictEqual(ctx.clampNumber(undefined, 1, 100, 10), 10, "undefined возвращает fallback");
    assert.strictEqual(ctx.clampNumber("45.8", 1, 100, 10), 45, "Дробная строка парсится как целое число");

    // --- 6.2 readBooleanSetting & writeBooleanSetting ---
    assert.strictEqual(ctx.readBooleanSetting("nonexistent_bool", false), false);
    assert.strictEqual(ctx.readBooleanSetting("nonexistent_bool", true), true);

    ctx.writeBooleanSetting("my_bool", true);
    assert.strictEqual(ctx.readBooleanSetting("my_bool", false), true);

    ctx.writeBooleanSetting("my_bool", false);
    assert.strictEqual(ctx.readBooleanSetting("my_bool", true), false);

    // --- 6.3 readNumberSetting & writeNumberSetting ---
    assert.strictEqual(ctx.readNumberSetting("nonexistent_num", 12, 1, 100), 12);

    ctx.writeNumberSetting("my_num", 24);
    assert.strictEqual(ctx.readNumberSetting("my_num", 12, 1, 100), 24);

    ctx.writeNumberSetting("out_of_bounds", 9999);
    assert.strictEqual(ctx.readNumberSetting("out_of_bounds", 10, 1, 50), 50);

    ctx.writeNumberSetting("too_small", -100);
    assert.strictEqual(ctx.readNumberSetting("too_small", 10, 1, 50), 1);
});

// ==========================================
// TEST 7: Связывание UI чекбокса onlyNewViewers и localStorage
// ==========================================
test("Test 7: UI чекбокс onlyNewViewers корректно обновляет состояние и сохраняет в localStorage", async () => {
    const env = createTestEnvironment({
        localStorage: {
            viewerOnlyNew: "false"
        }
    });

    const onlyNewInput = env.getMockElement("onlyNewViewers");

    // Проверяем начальное заполнение из localStorage
    assert.strictEqual(onlyNewInput.checked, false);

    // Симулируем включение чекбокса пользователем
    onlyNewInput.checked = true;
    onlyNewInput.dispatchEvent("change");

    assert.strictEqual(env.localStorage.getItem("viewerOnlyNew"), "true", "Изменение чекбокса сохранилось в localStorage");

    // Проверяем, что логика checkViewer теперь фильтрует обычного зрителя
    env.viewersDb.set("old_user", { username: "old_user", firstSeen: 1700000000000 });
    await env.checkViewer("old_user");

    // Так как onlyNewViewers = true, обычный зритель скрыт
    assert.strictEqual(env.shownFeedEvents.length, 0);
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
