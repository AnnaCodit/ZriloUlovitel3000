# Followers and Streamer Average Viewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display follower count with the label `"Фоловеров: <count>"` and display average stream viewers with the label `"Зрителей: <count>"` for streamers fetched from TwitchTracker summary API in ZriloUlovitel3000 viewer cards.

**Architecture:** Extend card DOM with a flex wrapper `.stats` holding `.followers` and `.average_viewers`. Fetch TwitchTracker summary concurrently during visible profiles processing, store `avgViewers` inside the existing IndexedDB `profiles` store, and render formatted counts with `.count` spans.

**Tech Stack:** Vanilla JavaScript (ES2022), HTML5, CSS, IndexedDB, Node.js test runner.

## Global Constraints

- Follower count formatting: `"Фоловеров: <span class=\"count\">N</span>"`
- Average viewers formatting: `"Зрителей: <span class=\"count\">N</span>"`
- TwitchTracker summary API endpoint: `https://twitchtracker.com/api/channels/summary/{channel}`
- Wrapper class: `.stats` with `display: flex; flex-wrap: wrap;`
- Value span class: `.count` with green styling `#00ff41` and bold font
- All existing tests in `tests/settings-and-filter.test.js` and `tests/twitch-links.test.js` must continue passing

---

### Task 1: Create Test Suite for Stats Markup, Formatting, and TwitchTracker Fetching

**Files:**
- Create: `tests/viewer-stats.test.js`

**Interfaces:**
- Consumes: `showTwitchUser`, `applyProfileToVisibleCards`, `fetchTwitchTrackerSummary` from `script.js`
- Produces: automated test suite runnable via `node tests/viewer-stats.test.js`

- [ ] **Step 1: Write the test suite**

Write `tests/viewer-stats.test.js` covering:
1. `showTwitchUser` renders `.stats` container containing `.followers` and `.average_viewers` elements.
2. `applyProfileToVisibleCards` formats `.followers` as `Фоловеров: <span class="count">${count}</span>`.
3. `applyProfileToVisibleCards` formats `.average_viewers` as `Зрителей: <span class="count">${count}</span>` when `avgViewers` is positive.
4. `applyProfileToVisibleCards` sets `.average_viewers` empty when `avgViewers` is missing or null.
5. `fetchTwitchTrackerSummary` fetches and returns parsed `avg_viewers` or null on empty/error responses.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/viewer-stats.test.js`
Expected: FAIL (functions not yet updated or defined)

- [ ] **Step 3: Commit initial test suite**

```bash
git add tests/viewer-stats.test.js
git commit -m "test: add test suite for followers and average viewers display"
```

---

### Task 2: Implement TwitchTracker Fetching, Card Markup, and Styling

**Files:**
- Modify: `script.js`
- Modify: `style.css`
- Test: `tests/viewer-stats.test.js`

**Interfaces:**
- Consumes: TwitchTracker API `https://twitchtracker.com/api/channels/summary/${channel}`
- Produces: updated `showTwitchUser`, `applyProfileToVisibleCards`, `fetchTwitchTrackerSummary`, `processVisibleProfiles`, CSS rules for `.stats` and `.count`.

- [ ] **Step 1: Update `script.js` DOM markup in `showTwitchUser`**

Update `showTwitchUser` template:
```javascript
        <div class="info">
            <a class="nickname" href="https://twitch.tv/${encodeURIComponent(normalizedUsername)}" target="_blank" rel="noopener noreferrer"></a>
            <div class="stats">
                <div class="followers"></div>
                <div class="average_viewers"></div>
            </div>
            <div class="bio"></div>
            <div class="datetime">[${time}]</div> 
            <div class="type">[${type}]</div> 
        </div>
```

- [ ] **Step 2: Implement `fetchTwitchTrackerSummary` in `script.js`**

```javascript
async function fetchTwitchTrackerSummary(username) {
    if (!username || typeof username !== 'string') return null;
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser) return null;

    const url = `https://twitchtracker.com/api/channels/summary/${encodeURIComponent(cleanUser)}`;
    let timeout;
    try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 7000);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const data = await response.json();
        if (data && typeof data.avg_viewers === 'number' && Number.isFinite(data.avg_viewers) && data.avg_viewers > 0) {
            return Math.round(data.avg_viewers);
        }
        return null;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
```

- [ ] **Step 3: Update `processVisibleProfiles` to fetch and combine TwitchTracker data**

In `processVisibleProfiles`:
```javascript
            for (let index = 0; index < profilesToLoad.length; index += PROFILE_BATCH_SIZE) {
                const visibleNow = new Set(getVisibleUsernames());
                const batch = profilesToLoad
                    .slice(index, index + PROFILE_BATCH_SIZE)
                    .filter((username) => visibleNow.has(username));

                if (batch.length === 0) continue;

                const [profilesResult, trackerResults] = await Promise.all([
                    getTwitchUsersData(batch).catch((err) => {
                        console.error("Ошибка загрузки профилей IVR:", err);
                        return new Map();
                    }),
                    Promise.allSettled(batch.map((u) => fetchTwitchTrackerSummary(u)))
                ]);

                const profiles = profilesResult || new Map();
                const combinedProfiles = new Map();

                batch.forEach((username, i) => {
                    const ivrProfile = profiles.get(username) || { login: username };
                    const trackerRes = trackerResults[i];
                    const avgViewers = (trackerRes && trackerRes.status === 'fulfilled') ? trackerRes.value : null;

                    combinedProfiles.set(username, {
                        ...ivrProfile,
                        avgViewers: avgViewers
                    });
                });

                await cacheProfileBatch(batch, combinedProfiles);
                combinedProfiles.forEach((profile, username) => {
                    applyProfileToVisibleCards(username, profile);
                });
            }
```

- [ ] **Step 4: Update `applyProfileToVisibleCards` to render formatted labels**

```javascript
        const followers = line.querySelector('.followers');
        const avgViewers = line.querySelector('.average_viewers');

        if (followers) {
            if (userData.followers !== undefined && userData.followers !== null && userData.followers !== '') {
                followers.innerHTML = `Фоловеров: <span class="count">${Number(userData.followers).toLocaleString('ru-RU')}</span>`;
            } else {
                followers.textContent = '';
            }
        }

        if (avgViewers) {
            if (userData.avgViewers !== undefined && userData.avgViewers !== null && userData.avgViewers > 0) {
                avgViewers.innerHTML = `Зрителей: <span class="count">${Number(userData.avgViewers).toLocaleString('ru-RU')}</span>`;
            } else {
                avgViewers.textContent = '';
            }
        }
```

- [ ] **Step 5: Add CSS styling to `style.css`**

Add styling for `.line .stats`, `.line .stats .count`, and update `.line .followers`:
```css
.line .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 15px;
    margin: 4px 0;
}

.line .stats .followers,
.line .stats .average_viewers {
    font-size: 18px;
    color: #666;
}

.line .stats .count {
    color: #00ff41;
    font-weight: bold;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests/viewer-stats.test.js`
Expected: PASS

- [ ] **Step 7: Commit changes**

```bash
git add script.js style.css
git commit -m "feat: display formatted followers and average viewers with TwitchTracker integration"
```

---

### Task 3: Comprehensive Verification Across All Test Suites

**Files:**
- Test: `tests/settings-and-filter.test.js`
- Test: `tests/twitch-links.test.js`
- Test: `tests/viewer-stats.test.js`

- [ ] **Step 1: Run all test suites**

```bash
node tests/settings-and-filter.test.js
node tests/twitch-links.test.js
node tests/viewer-stats.test.js
```
Expected: All tests pass with 0 failures.

- [ ] **Step 2: Commit final verification notes**

```bash
git commit --allow-empty -m "chore: verify all test suites pass"
```
