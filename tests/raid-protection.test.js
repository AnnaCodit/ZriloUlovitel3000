/**
 * Automated Unit Test Suite for ZriloUlovitel3000 Raid Protection
 * Tests batch join buffering, raid threshold detection, temporary database marking,
 * promotion of returning raid viewers, and UI settings for raidThreshold.
 *
 * Run with: node tests/raid-protection.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createTestEnvironment(options = {}) {
    const appScripts = [
        path.join(__dirname, '../js/utils.js'),
        path.join(__dirname, '../js/db.js'),
        path.join(__dirname, '../js/api.js'),
        path.join(__dirname, '../js/ui.js'),
        path.join(__dirname, '../js/twitch.js'),
        path.join(__dirname, '../script.js')
    ];
    const scriptCode = appScripts.map((file) => fs.readFileSync(file, 'utf-8')).join('\n;\n');

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
                classList: (() => {
                    const classes = new Set();
                    return {
                        add: (...cls) => cls.forEach((c) => classes.add(c)),
                        remove: (...cls) => cls.forEach((c) => classes.delete(c)),
                        toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
                        contains: (c) => classes.has(c)
                    };
                })(),
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
    const shownRaidAlerts = [];
    let currentTime = options.now || Date.now();

    let reloadCount = 0;
    const mockLocation = {
        reload: () => { reloadCount++; }
    };

    let lastOpenReq = null;

    const sandbox = {
        MY_TWITCH_CHANNEL: options.channel || 'testchannel',
        BOTS: options.bots || ['streamelements', 'nightbot', 'fossabot'],
        COOL_USERS: options.coolUsers || ['farostg', 'annacodit'],
        MAX_LOG_LINES: 50,
        RAID_THRESHOLD: options.raidThreshold,
        localStorage: mockLocalStorage,
        window: { location: mockLocation },
        location: mockLocation,
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
                    on: () => {},
                    join: () => Promise.resolve(),
                    part: () => Promise.resolve(),
                    disconnect: () => Promise.resolve()
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

    context.showTwitchUser = function (type, username, cssClass) {
        shownFeedEvents.push({
            type,
            username,
            cssClass,
            time: currentTime
        });
    };

    context.showRaidAlert = function (count) {
        shownRaidAlerts.push({
            count,
            time: currentTime
        });
    };

    context.initializeViewerSettings();

    return {
        ctx: context,
        viewersDb,
        profilesDb,
        shownFeedEvents,
        shownRaidAlerts,
        localStorage: mockLocalStorage,
        getMockElement: (id) => getOrCreateElement(id),
        getReloadCount: () => reloadCount,
        setNow(ts) {
            currentTime = ts;
        },
        enqueueViewer(username, event = 'join') {
            context.enqueueViewer(username, event);
        },
        flushJoinBuffer() {
            return new Promise((resolve) => {
                context.flushJoinBuffer();
                setTimeout(resolve, 10);
            });
        },
        checkViewer(username, event = '') {
            return new Promise((resolve) => {
                context.checkViewer(username, event);
                setTimeout(resolve, 10);
            });
        },
        updateNewViewersCount() {
            return new Promise((resolve) => {
                context.updateNewViewersCount();
                setTimeout(resolve, 10);
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
// TEST 1: Наплыв рейдеров >= порога -> групповой алерт и пометка temporary в БД
// ==========================================
test("Test 1: Наплыв рейдеров >= 10 -> выводится showRaidAlert, зрители пишутся в БД как temporary (без firstSeen)", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({ now: t0 });

    for (let i = 1; i <= 12; i++) {
        env.enqueueViewer(`raider_${i}`);
    }

    await env.flushJoinBuffer();

    assert.strictEqual(env.shownRaidAlerts.length, 1, "Должен быть вызван ровно 1 алерт рейда");
    assert.strictEqual(env.shownRaidAlerts[0].count, 12, "Счетчик рейда должен быть 12");
    assert.strictEqual(env.shownFeedEvents.length, 0, "Индивидуальные карточки не должны засорять ленту во время рейда");

    for (let i = 1; i <= 12; i++) {
        const username = `raider_${i}`;
        assert.strictEqual(env.viewersDb.has(username), true, `${username} должен быть сохранен в БД`);
        const record = env.viewersDb.get(username);
        assert.strictEqual(record.username, username);
        assert.strictEqual(record.temporary, true, `${username} должен иметь флаг temporary: true`);
        assert.strictEqual(record.firstSeen, undefined, `${username} не должен иметь firstSeen`);
    }
});

// ==========================================
// TEST 2: Временные рейдеры не учитываются в счетчике 'Новеньких за 24 часа'
// ==========================================
test("Test 2: Временные зрители с флагом temporary не увеличивают счетчик 24ч", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({ now: t0 });

    for (let i = 1; i <= 15; i++) {
        env.enqueueViewer(`raider_${i}`);
    }
    await env.flushJoinBuffer();
    await env.updateNewViewersCount();

    const countEl = env.getMockElement("new-viewers");
    assert.strictEqual(countEl.innerText, 0, "Счетчик новеньких должен оставаться 0 для временных зрителей");
});

// ==========================================
// TEST 3: Повторный индивидуальный заход временного зрителя -> конвертация в 'настоящего' нового
// ==========================================
test("Test 3: Повторный индивидуальный заход временного зрителя -> повышается до постоянного, алерт ALERT (new), +1 к счетчику 24ч", async () => {
    const t0 = 1700000000000;
    const t1 = 1700000050000;

    const env = createTestEnvironment({
        now: t0,
        initialViewers: {
            raider_bob: { username: "raider_bob", temporary: true }
        }
    });

    env.setNow(t1);
    await env.checkViewer("raider_bob");
    await env.updateNewViewersCount();

    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.deepStrictEqual(env.shownFeedEvents[0], {
        type: "ALERT",
        username: "raider_bob",
        cssClass: "new",
        time: t1
    });

    const record = env.viewersDb.get("raider_bob");
    assert.strictEqual(record.username, "raider_bob");
    assert.strictEqual(record.temporary, undefined, "Флаг temporary должен быть удален");
    assert.strictEqual(record.firstSeen, t1, "firstSeen должен быть установлен в текущее время");

    const countEl = env.getMockElement("new-viewers");
    assert.strictEqual(countEl.innerText, 1, "Счетчик новеньких теперь должен быть 1");
});

// ==========================================
// TEST 4: Третий заход уже конвертированного зрителя -> обычный старичок JOIN
// ==========================================
test("Test 4: Последующий заход уже конвертированного зрителя -> воспринимается как старичок (JOIN)", async () => {
    const t0 = 1700000000000;
    const t1 = 1700000050000;
    const t2 = 1700000100000;

    const env = createTestEnvironment({
        now: t0,
        initialViewers: {
            raider_bob: { username: "raider_bob", temporary: true }
        }
    });

    env.setNow(t1);
    await env.checkViewer("raider_bob");
    assert.strictEqual(env.shownFeedEvents.length, 1);
    assert.strictEqual(env.shownFeedEvents[0].type, "ALERT");

    env.setNow(t2);
    await env.checkViewer("raider_bob");
    assert.strictEqual(env.shownFeedEvents.length, 2);
    assert.deepStrictEqual(env.shownFeedEvents[1], {
        type: "JOIN",
        username: "raider_bob",
        cssClass: "normal",
        time: t2
    });
});

// ==========================================
// TEST 5: Старичок среди рейдовой пачки не портит свой статус
// ==========================================
test("Test 5: Существующий постоянный зритель в пачке рейда остается постоянным", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        initialViewers: {
            regular_user: { username: "regular_user", firstSeen: 1600000000000 }
        }
    });

    env.enqueueViewer("regular_user");
    for (let i = 1; i <= 10; i++) {
        env.enqueueViewer(`new_raider_${i}`);
    }

    await env.flushJoinBuffer();

    const regularRecord = env.viewersDb.get("regular_user");
    assert.strictEqual(regularRecord.firstSeen, 1600000000000, "firstSeen старичка не должен измениться");
    assert.strictEqual(regularRecord.temporary, undefined, "старичок не должен стать temporary");
});

// ==========================================
// TEST 6: Заходы ниже порога рейда (< 10) обрабатываются в штатном режиме
// ==========================================
test("Test 6: Заходы ниже порога (< 10) обрабатываются штатно как ALERT (new) для каждого", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({ now: t0 });

    env.enqueueViewer("solo_user_1");
    env.enqueueViewer("solo_user_2");
    env.enqueueViewer("solo_user_3");

    await env.flushJoinBuffer();

    assert.strictEqual(env.shownRaidAlerts.length, 0, "Рейд не должен сработать при 3 зрителях");
    assert.strictEqual(env.shownFeedEvents.length, 3, "Все 3 зрителя должны получить персональный ALERT");

    assert.strictEqual(env.viewersDb.get("solo_user_1").firstSeen, t0);
    assert.strictEqual(env.viewersDb.get("solo_user_2").firstSeen, t0);
    assert.strictEqual(env.viewersDb.get("solo_user_3").firstSeen, t0);
});

// ==========================================
// TEST 7: Боты фильтруются из буфера и не влияют на порог рейда
// ==========================================
test("Test 7: Боты из списка BOTS фильтруются и не накручивают счетчик рейда", async () => {
    const t0 = 1700000000000;
    const env = createTestEnvironment({
        now: t0,
        bots: ['streamelements', 'nightbot', 'fossabot']
    });

    for (let i = 0; i < 8; i++) {
        env.enqueueViewer('streamelements');
        env.enqueueViewer('nightbot');
    }
    env.enqueueViewer('user_a');
    env.enqueueViewer('user_b');
    env.enqueueViewer('user_c');

    await env.flushJoinBuffer();

    assert.strictEqual(env.shownRaidAlerts.length, 0, "Рейд не должен сработать из-за ботов");
    assert.strictEqual(env.shownFeedEvents.length, 3, "Только 3 реальных зрителя выведены");
});

// ==========================================
// TEST 8: Настройка raidThreshold через localStorage и UI инпут
// ==========================================
test("Test 8: UI инпут raidThreshold считывает значение, зажимает в диапазон [2, 100] и сохраняет в localStorage", () => {
    const env = createTestEnvironment({
        localStorage: {
            raidThreshold: "15"
        }
    });

    const thresholdInput = env.getMockElement("raidThreshold");
    assert.strictEqual(thresholdInput.value, 15, "Начальное значение должно быть 15 из localStorage");

    thresholdInput.value = "1";
    thresholdInput.dispatchEvent("change");
    assert.strictEqual(env.localStorage.getItem("raidThreshold"), "2", "Значение < 2 зажимается до 2");

    thresholdInput.value = "250";
    thresholdInput.dispatchEvent("change");
    assert.strictEqual(env.localStorage.getItem("raidThreshold"), "100", "Значение > 100 зажимается до 100");

    thresholdInput.value = "25";
    thresholdInput.dispatchEvent("input");
    assert.strictEqual(env.localStorage.getItem("raidThreshold"), "25");
});

// ==========================================
// TEST 9: Конфигурационный RAID_THRESHOLD учитывается как fallback
// ==========================================
test("Test 9: Кастомный RAID_THRESHOLD из config учитывается при отсутствии localStorage", () => {
    const env = createTestEnvironment({
        raidThreshold: 20
    });

    const ctx = env.ctx;
    assert.strictEqual(ctx.getRaidThreshold(), 20);
});

// --- RUNNER ---

async function runTestSuite() {
    console.log("==================================================");
    console.log("  Running ZriloUlovitel3000 Raid Protection Tests ");
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
