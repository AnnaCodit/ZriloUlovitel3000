# Design Specification: Followers and Streamer Average Viewers Display

## 1. Overview
Enhance the viewer cards in ZriloUlovitel3000 to display follower counts with the label `"Фоловеров: <count>"` and optionally show the average stream viewers as `"Зрителей: <count>"` (fetched from the TwitchTracker summary API) whenever the viewer is a streamer with average viewership data.

## 2. Requirements & Goals
- Follower count formatting: Display `"Фоловеров: <span class=\"count\">N</span>"` instead of a raw number.
- Average viewers stat: If `avg_viewers` is present and positive in TwitchTracker API response (`https://twitchtracker.com/api/channels/summary/{channel}`), display `"Зрителей: <span class=\"count\">N</span>"`. If missing, 0, or non-streamer, display nothing.
- Layout: Inside `.info`, group stats into a flexible wrapper `.stats` with `display: flex; flex-wrap: wrap; gap: 15px;`, containing `.followers` and `.average_viewers`. Numbers wrapped in `.count` span elements.
- Caching: Persist `avgViewers` data alongside IVR user profile in IndexedDB (`profiles` store) with the existing 12-hour TTL to prevent redundant network requests and avoid API rate limits.
- Resilience: If TwitchTracker API request fails or times out, the user profile (IVR data) still displays without interruption.

## 3. Architecture & Data Flow

### 3.1 Network Requests & Batching
1. `fetchTwitchTrackerSummary(username)`:
   - Fetches `https://twitchtracker.com/api/channels/summary/${encodeURIComponent(username)}`.
   - Uses `AbortController` with a 7-second timeout.
   - Handles network errors, non-200 responses, or empty JSON `{}` gracefully, returning `null`.
   - Returns parsed `avg_viewers` integer if `Number.isFinite(data.avg_viewers) && data.avg_viewers > 0`, otherwise `null`.
2. `processVisibleProfiles()`:
   - For any un-cached username in the active batch:
     - Fetches IVR profiles via `getTwitchUsersData(batch)`.
     - Concurrently fetches TwitchTracker summary for each username in batch via `Promise.allSettled(batch.map(fetchTwitchTrackerSummary))`.
     - Merges `avgViewers` into each user profile object.
     - Saves combined profile into IndexedDB `profiles` store.

### 3.2 DOM Structure (`showTwitchUser`)
Each viewer entry card `.line` contains:
```html
<div class="avatar">
    <img hidden>
</div>
<div class="info">
    <a class="nickname" href="..." target="_blank" rel="noopener noreferrer"></a>
    <div class="stats">
        <div class="followers"></div>
        <div class="average_viewers"></div>
    </div>
    <div class="bio"></div>
    <div class="datetime">[${time}]</div> 
    <div class="type">[${type}]</div> 
</div>
<div class="timer-bar"></div>
```

### 3.3 DOM Updating (`applyProfileToVisibleCards`)
When profile data is applied to cards:
- `.followers`:
  - If `userData.followers !== undefined && userData.followers !== null`:
    `line.querySelector('.followers').innerHTML = 'Фоловеров: <span class="count">' + escapeHtml(userData.followers) + '</span>';`
  - Otherwise, `.followers.textContent = '';`
- `.average_viewers`:
  - If `userData.avgViewers !== undefined && userData.avgViewers !== null && userData.avgViewers > 0`:
    `line.querySelector('.average_viewers').innerHTML = 'Зрителей: <span class="count">' + escapeHtml(userData.avgViewers) + '</span>';`
  - Otherwise, `.average_viewers.textContent = '';`

### 3.4 CSS Styling (`style.css`)
```css
.line .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 15px;
    font-size: 18px;
    color: #888;
    margin: 4px 0;
}

.line .stats .count {
    color: #00ff41;
    font-weight: bold;
}
```

## 4. Verification & Testing
- Automated unit test suite in `tests/viewer-stats.test.js` verifying:
  - Formatting of `.followers` with `"Фоловеров: <span class=\"count\">...</span>"`.
  - Formatting of `.average_viewers` when `avgViewers` exists.
  - Omission / blank `.average_viewers` when `avgViewers` is null, undefined, or missing.
  - IndexedDB caching of `avgViewers` with IVR profile data.
- Run all test suites (`node tests/settings-and-filter.test.js`, `node tests/twitch-links.test.js`, `node tests/viewer-stats.test.js`).
