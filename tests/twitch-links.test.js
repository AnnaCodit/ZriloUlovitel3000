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
        get firstElementChild() { return this.children[0] || null; },
        get lastElementChild() { return this.children[this.children.length - 1] || null; },
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

    let innerHTMLValue = '';
    Object.defineProperty(node, 'innerHTML', {
        get() { return innerHTMLValue; },
        set(val) {
            innerHTMLValue = val;
            this.children = [];
            parseHtmlFragment(val, this);
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
            currentParent.textContent = (currentParent.textContent || '') + trimmed;
        }
    }
}

function querySelectorInternal(root, selector) {
    const all = [];
    querySelectorAllInternal(root, selector, all);
    return all[0] || null;
}

function querySelectorAllInternal(node, selector, results) {
    for (const child of node.children) {
        let matches = false;
        if (selector === 'a.nickname') {
            if (child.tagName === 'A' && child.classList.contains('nickname')) matches = true;
        } else if (selector === '.avatar img') {
            if (child.tagName === 'IMG' && node.classList && node.classList.contains('avatar')) matches = true;
        } else if (selector.startsWith('.')) {
            if (child.classList.contains(selector.slice(1))) matches = true;
        } else if (selector.includes('[data-username]')) {
            if (child.dataset && child.dataset.username) matches = true;
        } else if (child.tagName === selector.toUpperCase()) {
            matches = true;
        }

        if (matches) results.push(child);
        querySelectorAllInternal(child, selector, results);
    }
}

function setupTest(overrides = {}) {
    const appScripts = [
        path.join(__dirname, '../js/utils.js'),
        path.join(__dirname, '../js/db.js'),
        path.join(__dirname, '../js/api.js'),
        path.join(__dirname, '../js/ui.js'),
        path.join(__dirname, '../js/twitch.js'),
        path.join(__dirname, '../script.js')
    ];
    const scriptCode = appScripts.map((file) => fs.readFileSync(file, 'utf-8')).join('\n;\n');

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
            return [];
        },
        createElement: (tag) => createSimpleDomNode(tag),
        documentElement: { style: { setProperty: () => {} } }
    };

    const sandbox = {
        MY_TWITCH_CHANNEL: 'testchannel',
        BOTS: ['nightbot'],
        COOL_USERS: ['vip_user'],
        MAX_LOG_LINES: 10,
        RECENT_VIEWER_DURATION_SEC: overrides.recentViewerDuration,
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
        indexedDB: { open: () => ({ onsuccess: null, onupgradeneeded: null }) },
        IDBKeyRange: { lowerBound: (v) => v },
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptCode, context);

    return {
        context,
        viewersDiv,
        showTwitchUser: context.showTwitchUser,
        applyProfileToVisibleCards: context.applyProfileToVisibleCards,
        getRecentViewerDuration: context.getRecentViewerDuration
    };
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// Test 1: Инициализация карточки зрителя
test("showTwitchUser renders .nickname as an <a> link with twitch.tv url", () => {
    const { showTwitchUser, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "RandomViewer123", "normal");

    const line = viewersDiv.firstChild;
    assert.ok(line, "Line was created");
    assert.strictEqual(line.dataset.username, "randomviewer123");

    const nickname = line.querySelector('.nickname');
    assert.ok(nickname, ".nickname element exists");
    assert.strictEqual(nickname.tagName, "A", ".nickname is an <a> anchor tag");
    assert.strictEqual(nickname.href, "https://twitch.tv/randomviewer123", "href points to twitch channel");
    assert.strictEqual(nickname.target, "_blank", "target is _blank");
    assert.strictEqual(nickname.rel, "noopener noreferrer", "rel is noopener noreferrer");
    assert.strictEqual(nickname.textContent, "RandomViewer123", "textContent has initial user_name");
});

// Test 2: Применение профиля с кастомным регистром displayName
test("applyProfileToVisibleCards sets textContent to displayName and href to canonical login", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("ALERT", "notyetdeadred", "new");

    const userData = {
        login: "notyetdeadred",
        displayName: "NotYetDeadRed",
        followers: 1234,
        bio: "Just a streamer"
    };

    applyProfileToVisibleCards("notyetdeadred", userData);

    const line = viewersDiv.firstChild;
    const nickname = line.querySelector('.nickname');
    assert.strictEqual(nickname.textContent, "NotYetDeadRed", "textContent updated to displayName with custom casing");
    assert.strictEqual(nickname.href, "https://twitch.tv/notyetdeadred", "href points to canonical login");
});

// Test 3: Применение профиля с не-ASCII / локализованным displayName
test("applyProfileToVisibleCards handles localized non-ASCII displayNames correctly", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "calmdownman", "normal");

    const userData = {
        login: "calmdownman",
        displayName: "침착맨",
        followers: 500000,
        bio: "침착맨 채널입니다"
    };

    applyProfileToVisibleCards("calmdownman", userData);

    const line = viewersDiv.firstChild;
    const nickname = line.querySelector('.nickname');
    assert.strictEqual(nickname.textContent, "침착맨", "textContent contains Korean displayName");
    assert.strictEqual(nickname.href, "https://twitch.tv/calmdownman", "href uses ASCII login in URL");
});

// Test 4: Фолбэк при отсутствии displayName
test("applyProfileToVisibleCards falls back cleanly if displayName is missing", () => {
    const { showTwitchUser, applyProfileToVisibleCards, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "simpleuser", "normal");

    const userData = {
        login: "simpleuser",
        displayName: "",
        followers: 10
    };

    applyProfileToVisibleCards("simpleuser", userData);

    const line = viewersDiv.firstChild;
    const nickname = line.querySelector('.nickname');
    assert.strictEqual(nickname.textContent, "simpleuser");
    assert.strictEqual(nickname.href, "https://twitch.tv/simpleuser");
});

// Test 5: Горизонтальная полоска .timer-bar с длительностью из конфига
test("showTwitchUser creates .timer-bar with duration from RECENT_VIEWER_DURATION_SEC (default 60s)", () => {
    const { showTwitchUser, viewersDiv } = setupTest();

    showTwitchUser("JOIN", "speedy", "normal");

    const line = viewersDiv.firstChild;
    const timerBar = line.querySelector('.timer-bar');
    assert.ok(timerBar, ".timer-bar element exists inside .line");
    assert.strictEqual(timerBar.style.animationDuration, "60s", "default animation-duration is 60s");
});

// Test 6: Кастомная длительность таймера из конфига
test("showTwitchUser respects custom RECENT_VIEWER_DURATION_SEC from config", () => {
    const { showTwitchUser, viewersDiv } = setupTest({ recentViewerDuration: 45 });

    showTwitchUser("JOIN", "customtimer", "normal");

    const line = viewersDiv.firstChild;
    const timerBar = line.querySelector('.timer-bar');
    assert.ok(timerBar, ".timer-bar element exists");
    assert.strictEqual(timerBar.style.animationDuration, "45s", "animation-duration matches config 45s");
});

// Test 7: Окончание анимации удаляет .timer-bar и снимает класс just-added
test("animationend event removes .timer-bar and removes just-added class from .line", () => {
    const { showTwitchUser, viewersDiv } = setupTest();

    showTwitchUser("ALERT", "brandnew", "new");

    const line = viewersDiv.firstChild;
    assert.strictEqual(line.classList.contains('just-added'), true);

    const timerBar = line.querySelector('.timer-bar');
    assert.ok(timerBar);

    // Триггерим окончание анимации
    timerBar.dispatchEvent('animationend');

    // Проверяем что полоска удалена из DOM
    assert.strictEqual(line.querySelector('.timer-bar'), null, ".timer-bar is removed after animationend");
    assert.strictEqual(line.classList.contains('just-added'), false, "just-added class is removed after animationend");
});

test('showTwitchUser does not throw when logDiv contains a text node (firstChild without classList)', () => {
    const { showTwitchUser, viewersDiv } = setupTest();
    // Имитируем текстовый узел пробела в HTML (<div id="viewers">\n </div>)
    const textNodeWithoutClassList = { nodeType: 3, nodeValue: '\n        ' };
    viewersDiv.firstChild = textNodeWithoutClassList;

    // Не должно выбрасывать Uncaught TypeError: Cannot read properties of undefined (reading 'add')
    assert.doesNotThrow(() => {
        showTwitchUser("JOIN", "testuser", "normal");
    });

    const firstCard = viewersDiv.children[0];
    assert.ok(firstCard, "Card is rendered");
    assert.strictEqual(firstCard.dataset.username, "testuser");

    // Второй вызов должен добавить separated к первому элементу
    assert.doesNotThrow(() => {
        showTwitchUser("ALERT", "seconduser", "special");
    });
    assert.strictEqual(firstCard.classList.contains('separated'), true, "first card got 'separated' class");
});

async function run() {
    console.log("==================================================");
    console.log("  Running ZriloUlovitel3000 Twitch Link & Timer Tests");
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
