const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createSimpleDomNode(tagName = 'div') {
    const node = {
        tagName: tagName.toUpperCase(),
        classList: {
            classes: new Set(),
            add(...cls) { cls.forEach(c => this.classes.add(c)); },
            remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
            contains(c) { return this.classes.has(c); }
        },
        dataset: {},
        attributes: {},
        style: {},
        children: [],
        firstChild: null,
        lastChild: null,
        textContent: '',
        innerText: '',
        alt: '',
        src: '',
        href: '',
        target: '',
        rel: '',
        hidden: false,
        listeners: new Map(),
        addEventListener(event, fn) {
            if (!this.listeners.has(event)) this.listeners.set(event, []);
            this.listeners.get(event).push(fn);
        },
        dispatchEvent(event) {
            const list = this.listeners.get(event) || [];
            list.forEach(fn => fn({ target: this }));
        },
        setAttribute(k, v) {
            this.attributes[k] = String(v);
            if (k === 'href') this.href = v;
            if (k === 'target') this.target = v;
            if (k === 'rel') this.rel = v;
            if (k === 'alt') this.alt = v;
        },
        getAttribute(k) { return this.attributes[k] || null; },
        prepend(child) {
            this.children.unshift(child);
            child.parentNode = this;
            this.firstChild = this.children[0];
            this.lastChild = this.children[this.children.length - 1];
        },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) this.children.splice(idx, 1);
            child.parentNode = null;
            this.firstChild = this.children[0] || null;
            this.lastChild = this.children[this.children.length - 1] || null;
        },
        remove() {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        },
        querySelector(selector) {
            return querySelectorInternal(this, selector);
        },
        querySelectorAll(selector) {
            const results = [];
            querySelectorAllInternal(this, selector, results);
            return results;
        }
    };

    let directText = '';
    Object.defineProperty(node, '_directText', {
        get() { return directText; },
        set(v) { directText = String(v); }
    });
    Object.defineProperty(node, 'textContent', {
        get() {
            let res = directText;
            for (const child of this.children) {
                const childText = child.textContent;
                if (childText) {
                    res += (res && !res.endsWith(' ') ? ' ' : '') + childText;
                }
            }
            return res;
        },
        set(val) {
            directText = String(val);
            this.children = [];
            this.firstChild = null;
            this.lastChild = null;
        }
    });

    let innerHTMLValue = '';
    Object.defineProperty(node, 'innerHTML', {
        get() { return innerHTMLValue; },
        set(val) {
            innerHTMLValue = String(val);
            this.children = [];
            this.textContent = '';
            parseHtmlFragment(innerHTMLValue, this);
            this.firstChild = this.children[0] || null;
            this.lastChild = this.children[this.children.length - 1] || null;
        }
    });

    return node;
}

function parseHtmlFragment(html, parent) {
    const tokens = html.match(/<[^>]+>|[^<]+/g) || [];
    const stack = [parent];

    for (const token of tokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('</')) {
            if (stack.length > 1) {
                stack.pop();
            }
        } else if (trimmed.startsWith('<')) {
            const isSelfClosing = trimmed.endsWith('/>') || /^<(img|br|hr|input|meta|link)/i.test(trimmed);
            const tagMatch = trimmed.match(/^<([a-zA-Z0-9]+)/);
            if (!tagMatch) continue;
            const tagName = tagMatch[1];
            const elem = createSimpleDomNode(tagName);

            const classMatch = trimmed.match(/class=["']([^"']+)["']/);
            if (classMatch) {
                classMatch[1].trim().split(/\s+/).forEach(c => elem.classList.add(c));
            }

            const hrefMatch = trimmed.match(/href=["']([^"']+)["']/);
            if (hrefMatch) {
                elem.href = hrefMatch[1];
                elem.setAttribute('href', hrefMatch[1]);
            }

            const targetMatch = trimmed.match(/target=["']([^"']+)["']/);
            if (targetMatch) {
                elem.target = targetMatch[1];
                elem.setAttribute('target', targetMatch[1]);
            }

            const relMatch = trimmed.match(/rel=["']([^"']+)["']/);
            if (relMatch) {
                elem.rel = relMatch[1];
                elem.setAttribute('rel', relMatch[1]);
            }

            const currentParent = stack[stack.length - 1];
            elem.parentNode = currentParent;
            currentParent.children.push(elem);

            if (!isSelfClosing) {
                stack.push(elem);
            }
        } else {
            const currentParent = stack[stack.length - 1];
            currentParent._directText = (currentParent._directText || '') + trimmed;
        }
    }
}

function matchSelector(node, selector) {
    if (!selector) return false;
    selector = selector.trim();

    if (selector.includes('[data-username]')) {
        if (!node.dataset || !node.dataset.username) return false;
        const remaining = selector.replace('[data-username]', '');
        if (!remaining) return true;
        return matchSelector(node, remaining);
    }

    if (selector.startsWith('#')) {
        return node.id === selector.slice(1);
    }

    if (selector.includes('.')) {
        const [tag, ...classes] = selector.split('.');
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        return classes.every(c => node.classList && node.classList.contains(c));
    }

    return node.tagName === selector.toUpperCase();
}

function querySelectorInternal(root, selector) {
    const all = [];
    querySelectorAllInternal(root, selector, all);
    return all[0] || null;
}

function querySelectorAllInternal(root, selector, results) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length === 1) {
        collectMatching(root, parts[0], results);
    } else {
        let currentLevel = [root];
        for (const part of parts) {
            const nextLevel = [];
            for (const elem of currentLevel) {
                collectMatching(elem, part, nextLevel);
            }
            currentLevel = nextLevel;
        }
        results.push(...currentLevel);
    }
}

function collectMatching(node, simpleSelector, results) {
    for (const child of node.children) {
        if (matchSelector(child, simpleSelector)) {
            results.push(child);
        }
        collectMatching(child, simpleSelector, results);
    }
}

function setupTest(overrides = {}) {
    const scriptPath = path.join(__dirname, '../script.js');
    const scriptCode = fs.readFileSync(scriptPath, 'utf-8');

    const viewersDiv = createSimpleDomNode('div');
    viewersDiv.id = 'viewers';
    const logDiv = createSimpleDomNode('div');
    logDiv.id = 'log';
    const channelSpan = createSimpleDomNode('span');
    channelSpan.id = 'channel';

    const domElements = new Map([
        ['viewers', viewersDiv],
        ['log', logDiv],
        ['channel', channelSpan]
    ]);

    const documentMock = {
        getElementById: (id) => domElements.get(id) || createSimpleDomNode('div'),
        querySelector: (sel) => {
            if (sel === '#viewers') return viewersDiv;
            return querySelectorInternal(viewersDiv, sel);
        },
        querySelectorAll: (sel) => {
            if (sel === '#viewers .line[data-username]') {
                return viewersDiv.children.filter(c => c.dataset && c.dataset.username);
            }
            const results = [];
            querySelectorAllInternal(viewersDiv, sel, results);
            return results;
        },
        createElement: (tag) => createSimpleDomNode(tag),
        documentElement: { style: { setProperty: () => {} } }
    };

    let fetchHandler = overrides.fetch || (() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
    }));

    const profilesDb = new Map();
    if (overrides.initialProfiles) {
        for (const [k, v] of Object.entries(overrides.initialProfiles)) {
            profilesDb.set(k, JSON.parse(JSON.stringify(v)));
        }
    }

    const mockProfilesStore = {
        get(username) {
            const result = profilesDb.has(username)
                ? JSON.parse(JSON.stringify(profilesDb.get(username)))
                : undefined;
            const req = { result, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        },
        put(record) {
            profilesDb.set(record.username, JSON.parse(JSON.stringify(record)));
            const req = { result: record.username, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
            });
            return req;
        }
    };

    const mockDb = {
        transaction(stores, mode) {
            const tx = {
                objectStore(name) {
                    if (name === 'profiles') return mockProfilesStore;
                    return {
                        get: () => ({ onsuccess: null }),
                        put: () => ({ onsuccess: null }),
                        add: () => ({ onsuccess: null }),
                        index: () => ({ count: () => ({ onsuccess: null }) })
                    };
                },
                oncomplete: null,
                onerror: null,
                onabort: null
            };
            queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') tx.oncomplete();
            });
            return tx;
        }
    };

    let openRequest;
    const sandbox = {
        MY_TWITCH_CHANNEL: 'testchannel',
        BOTS: ['nightbot'],
        COOL_USERS: ['vip_user'],
        MAX_LOG_LINES: 10,
        localStorage: {
            getItem: () => null,
            setItem: () => {}
        },
        document: documentMock,
        Date: class extends Date {
            toLocaleTimeString() { return '12:00:00'; }
            static now() { return 1700000000000; }
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
                openRequest = {
                    result: mockDb,
                    onsuccess: null,
                    onupgradeneeded: null
                };
                return openRequest;
            }
        },
        IDBKeyRange: { lowerBound: (v) => v },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: (...args) => fetchHandler(...args),
        AbortController: typeof AbortController !== 'undefined' ? AbortController : class {
            constructor() {
                this.signal = {};
            }
            abort() {}
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setFetchHandler: (fn) => { fetchHandler = fn; }
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptCode, context);
    if (openRequest && typeof openRequest.onsuccess === 'function') {
        openRequest.onsuccess({ target: openRequest });
    }

    return {
        context,
        viewersDiv,
        showTwitchUser: context.showTwitchUser,
        applyProfileToVisibleCards: context.applyProfileToVisibleCards,
        fetchTwitchTrackerSummary: context.fetchTwitchTrackerSummary,
        processVisibleProfiles: context.processVisibleProfiles,
        profilesDb,
        setFetchHandler: (fn) => { fetchHandler = fn; }
    };
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ====================================================================
// Test 1: DOM разметка карточки зрителя (.stats, .followers, .average_viewers, .created_at, .last_stream)
// ====================================================================
test("showTwitchUser renders .stats container containing .followers, .average_viewers, and .created_at, plus .last_stream in .info", () => {
    const { showTwitchUser, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "Streamer123", "normal");

    const line = viewersDiv.firstChild;
    assert.ok(line, "Line was created in feed");

    const stats = line.querySelector('.stats');
    assert.ok(stats, ".stats container exists inside .line");

    const followers = line.querySelector('.followers');
    assert.ok(followers, ".followers element exists");
    assert.strictEqual(followers.parentNode, stats, ".followers is a direct child of .stats");

    const avgViewers = line.querySelector('.average_viewers');
    assert.ok(avgViewers, ".average_viewers element exists");
    assert.strictEqual(avgViewers.parentNode, stats, ".average_viewers is a direct child of .stats");

    const createdAt = line.querySelector('.created_at');
    assert.ok(createdAt, ".created_at element exists");
    assert.strictEqual(createdAt.parentNode, stats, ".created_at is a direct child of .stats");

    const lastStream = line.querySelector('.last_stream');
    assert.ok(lastStream, ".last_stream element exists inside .info");

    assert.strictEqual(followers.textContent, "", "initial .followers is empty before profile load");
    assert.strictEqual(avgViewers.textContent, "", "initial .average_viewers is empty before profile load");
    assert.strictEqual(createdAt.textContent, "", "initial .created_at is empty before profile load");
    assert.strictEqual(lastStream.textContent, "", "initial .last_stream is empty before profile load");
});

// ====================================================================
// Test 2: Форматирование подписчиков (Фоловеров: <span class="count">N</span>)
// ====================================================================
test("applyProfileToVisibleCards formats .followers as 'Фоловеров: <span class=\"count\">${count}</span>'", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "streamer_dan", "normal");

    const userData = {
        login: "streamer_dan",
        displayName: "StreamerDan",
        followers: 12345
    };

    applyProfileToVisibleCards("streamer_dan", userData);

    const line = viewersDiv.firstChild;
    const followers = line.querySelector('.followers');
    assert.ok(followers, ".followers element exists");

    const countSpan = followers.querySelector('.count');
    assert.ok(countSpan, ".count span exists inside .followers");
    assert.strictEqual(countSpan.textContent, "12345", ".count span contains followers count without spaces");
    assert.strictEqual(followers.innerHTML, 'Фоловеров: <span class="count">12345</span>', "followers innerHTML has correct markup format without spaces");

    // Проверка 0 подписчиков
    applyProfileToVisibleCards("streamer_dan", { ...userData, followers: 0 });
    const countSpanZero = followers.querySelector('.count');
    assert.ok(countSpanZero, ".count span exists for 0 followers");
    assert.strictEqual(countSpanZero.textContent.trim(), "0", ".count span displays 0");
});

// ====================================================================
// Test 3: Форматирование среднего онлайна (Зрителей: <span class="count">N</span>) при avgViewers > 0
// ====================================================================
test("applyProfileToVisibleCards formats .average_viewers as 'Зрителей: <span class=\"count\">${count}</span>' when avgViewers is positive", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "bigstreamer", "normal");

    const userData = {
        login: "bigstreamer",
        displayName: "BigStreamer",
        followers: 50000,
        avgViewers: 150
    };

    applyProfileToVisibleCards("bigstreamer", userData);

    const line = viewersDiv.firstChild;
    const avgViewers = line.querySelector('.average_viewers');
    assert.ok(avgViewers, ".average_viewers element exists");

    const countSpan = avgViewers.querySelector('.count');
    assert.ok(countSpan, ".count span exists inside .average_viewers");
    assert.strictEqual(countSpan.textContent.replace(/\s+/g, ''), "150", ".count span contains avgViewers count");
    assert.match(avgViewers.innerHTML, /^Зрителей:\s*<span class="count">150<\/span>/, "average_viewers innerHTML has correct markup format");
});

// ====================================================================
// Test 4: Очистка / пропуск .average_viewers при отсутствии или неположительном avgViewers
// ====================================================================
test("applyProfileToVisibleCards sets .average_viewers empty when avgViewers is missing, null, or 0", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "casual_viewer", "normal");

    // 4.1 avgViewers = null
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        followers: 10,
        avgViewers: null
    });

    const line = viewersDiv.firstChild;
    const avgViewers = line.querySelector('.average_viewers');
    assert.ok(avgViewers, ".average_viewers element exists");
    assert.strictEqual(avgViewers.innerHTML.trim(), "", ".average_viewers is empty string when avgViewers is null");
    assert.strictEqual(avgViewers.querySelector('.count'), null, "no .count span when avgViewers is null");

    // 4.2 avgViewers = undefined / missing
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        followers: 10
    });
    assert.strictEqual(avgViewers.innerHTML.trim(), "", ".average_viewers is empty string when avgViewers is omitted");

    // 4.3 avgViewers = 0
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        followers: 10,
        avgViewers: 0
    });
    assert.strictEqual(avgViewers.innerHTML.trim(), "", ".average_viewers is empty string when avgViewers is 0");
});

// ====================================================================
// Test 5: TwitchTracker summary API (fetchTwitchTrackerSummary)
// ====================================================================
test("fetchTwitchTrackerSummary fetches and returns parsed avg_viewers or null on empty/error responses", async () => {
    let capturedUrl = '';
    const { fetchTwitchTrackerSummary, setFetchHandler } = setupTest();

    assert.strictEqual(typeof fetchTwitchTrackerSummary, 'function', "fetchTwitchTrackerSummary must be a defined function");

    // 5.1 Успешный ответ с avg_viewers > 0
    setFetchHandler(async (url) => {
        capturedUrl = url;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                avg_viewers: 245.8,
                followers: 12000,
                rank: 1500
            })
        };
    });

    const result = await fetchTwitchTrackerSummary("pro_streamer");
    assert.strictEqual(capturedUrl, "https://twitchtracker.com/api/channels/summary/pro_streamer", "calls correct TwitchTracker summary endpoint");
    assert.strictEqual(result, 246, "returns rounded avg_viewers integer");

    // 5.2 Ответ с avg_viewers = 0 или пустой JSON
    setFetchHandler(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ avg_viewers: 0 })
    }));
    const zeroResult = await fetchTwitchTrackerSummary("inactive_user");
    assert.strictEqual(zeroResult, null, "returns null when avg_viewers is 0");

    setFetchHandler(async () => ({
        ok: true,
        status: 200,
        json: async () => ({})
    }));
    const emptyResult = await fetchTwitchTrackerSummary("empty_data_user");
    assert.strictEqual(emptyResult, null, "returns null on empty JSON object");

    // 5.3 Ответ со статусом 404 / 500
    setFetchHandler(async () => ({
        ok: false,
        status: 404,
        json: async () => ({})
    }));
    const notFoundResult = await fetchTwitchTrackerSummary("non_existent_channel");
    assert.strictEqual(notFoundResult, null, "returns null on HTTP 404 error");

    // 5.4 Сетевая ошибка / timeout
    setFetchHandler(async () => {
        throw new Error("Network timeout");
    });
    const networkErrResult = await fetchTwitchTrackerSummary("failing_user");
    assert.strictEqual(networkErrResult, null, "returns null on network/fetch exception");

    // 5.5 Некорректные параметры (null, undefined, пустая строка)
    assert.strictEqual(await fetchTwitchTrackerSummary(""), null, "returns null for empty username");
    assert.strictEqual(await fetchTwitchTrackerSummary(null), null, "returns null for null username");
    assert.strictEqual(await fetchTwitchTrackerSummary(undefined), null, "returns null for undefined username");
});

// ====================================================================
// Test 6: Обновление устаревшего кэша (если в кэшированном профиле нет avgViewers)
// ====================================================================
test("processVisibleProfiles re-fetches TwitchTracker data when cached profile is missing avgViewers field", async () => {
    let trackerFetchCount = 0;
    const initialProfiles = {
        fra3a: {
            username: "fra3a",
            fetchedAt: 1700000000000 - 1000, // свежий кэш (1 сек назад), но старый формат без avgViewers
            data: {
                login: "fra3a",
                displayName: "FRA3A",
                followers: 2533
            }
        }
    };

    const { showTwitchUser, processVisibleProfiles, setFetchHandler, viewersDiv } = setupTest({
        initialProfiles,
        fetch: async (url) => {
            if (url.includes('twitchtracker.com/api/channels/summary/fra3a')) {
                trackerFetchCount++;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ avg_viewers: 94, followers_total: 2533 })
                };
            }
            if (url.includes('api.ivr.fi')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ([{ login: "fra3a", displayName: "FRA3A", followers: 2533 }])
                };
            }
            return { ok: true, json: async () => ({}) };
        }
    });

    // Добавляем карточку пользователя в DOM
    showTwitchUser("JOIN", "fra3a", "normal");

    // Вызываем обработку видимых профилей
    await processVisibleProfiles();

    assert.strictEqual(trackerFetchCount, 1, "TwitchTracker was queried for legacy cached user missing avgViewers");

    const line = viewersDiv.firstChild;
    const avgViewersEl = line.querySelector('.average_viewers');
    assert.ok(avgViewersEl, ".average_viewers element exists");
    assert.match(avgViewersEl.innerHTML, /Зрителей:\s*<span class="count">94<\/span>/, "average_viewers is populated with 94");
});

// ====================================================================
// Test 7: Форматирование даты создания аккаунта (Создан: <span class="count">YYYY.MM.DD</span>)
// ====================================================================
test("applyProfileToVisibleCards formats .created_at as 'Создан: <span class=\"count\">YYYY.MM.DD</span>'", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "streamer_dan", "normal");

    const userData = {
        login: "streamer_dan",
        displayName: "StreamerDan",
        createdAt: "2025-01-27T00:58:54.950382Z"
    };

    applyProfileToVisibleCards("streamer_dan", userData);

    const line = viewersDiv.firstChild;
    const createdAt = line.querySelector('.created_at');
    assert.ok(createdAt, ".created_at element exists");

    const countSpan = createdAt.querySelector('.count');
    assert.ok(countSpan, ".count span exists inside .created_at");
    assert.strictEqual(countSpan.textContent, "2025.01.27", ".count span contains formatted date YYYY.MM.DD");
    assert.strictEqual(createdAt.innerHTML, 'Создан: <span class="count">2025.01.27</span>', "created_at innerHTML has correct markup format");
});

// ====================================================================
// Test 8: Очистка / пропуск .created_at при отсутствии или невалидном createdAt
// ====================================================================
test("applyProfileToVisibleCards leaves .created_at empty when createdAt is missing, null, or invalid", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "casual_viewer", "normal");

    // 8.1 createdAt = null
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        createdAt: null
    });
    const line = viewersDiv.firstChild;
    const createdAt = line.querySelector('.created_at');
    assert.ok(createdAt, ".created_at element exists");
    assert.strictEqual(createdAt.innerHTML.trim(), "", ".created_at is empty string when createdAt is null");

    // 8.2 createdAt = undefined / omitted
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer"
    });
    assert.strictEqual(createdAt.innerHTML.trim(), "", ".created_at is empty string when createdAt is omitted");

    // 8.3 createdAt = invalid date string
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        createdAt: "invalid-date"
    });
    assert.strictEqual(createdAt.innerHTML.trim(), "", ".created_at is empty string when createdAt is invalid");
});

// ====================================================================
// Test 9: Форматирование названия последнего стрима (Стрим: <span class="title">...</span>)
// ====================================================================
test("applyProfileToVisibleCards formats .last_stream as 'Стрим: <span class=\"title\">...</span>' when lastBroadcast.title is present", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "streamer_dan", "normal");

    const streamTitle = "ПРО ВИТУБЕРОВ 😱 ПОБУХТИМ💬";
    const userData = {
        login: "streamer_dan",
        displayName: "StreamerDan",
        lastBroadcast: {
            startedAt: "2026-08-19T18:19:35.282411Z",
            title: streamTitle
        }
    };

    applyProfileToVisibleCards("streamer_dan", userData);

    const line = viewersDiv.firstChild;
    const lastStream = line.querySelector('.last_stream');
    assert.ok(lastStream, ".last_stream element exists");

    const titleSpan = lastStream.querySelector('.title');
    assert.ok(titleSpan, ".title span exists inside .last_stream");
    assert.strictEqual(titleSpan.textContent, streamTitle, ".title span contains broadcast title");
    assert.strictEqual(lastStream.textContent.trim(), `Стрим: ${streamTitle}`, "last_stream textContent is properly structured");
});

// ====================================================================
// Test 10: Очистка / пропуск .last_stream при отсутствии lastBroadcast или title
// ====================================================================
test("applyProfileToVisibleCards leaves .last_stream empty when lastBroadcast or title is missing / empty", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "casual_viewer", "normal");

    const line = viewersDiv.firstChild;
    const lastStream = line.querySelector('.last_stream');
    assert.ok(lastStream, ".last_stream element exists");

    // 10.1 lastBroadcast = null
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        lastBroadcast: null
    });
    assert.strictEqual(lastStream.innerHTML.trim(), "", ".last_stream is empty when lastBroadcast is null");

    // 10.2 lastBroadcast = { title: null }
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        lastBroadcast: { title: null }
    });
    assert.strictEqual(lastStream.innerHTML.trim(), "", ".last_stream is empty when title is null");

    // 10.3 lastBroadcast = { title: "   " }
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer",
        lastBroadcast: { title: "   " }
    });
    assert.strictEqual(lastStream.innerHTML.trim(), "", ".last_stream is empty when title is whitespace");

    // 10.4 lastBroadcast omitted
    applyProfileToVisibleCards("casual_viewer", {
        login: "casual_viewer"
    });
    assert.strictEqual(lastStream.innerHTML.trim(), "", ".last_stream is empty when lastBroadcast is omitted");
});

async function run() {
    console.log("==================================================");
    console.log("  Running ZriloUlovitel3000 Viewer Stats Tests");
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

    if (failed > 0) process.exit(1);
}

run();
