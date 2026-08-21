/**
 * Модуль пользовательского интерфейса (UI):
 * - Рендеринг карточек зрителей и предупреждений о рейдах
 * - Анимация таймеров захода
 * - Обогащение карточек профилями (IVR + TwitchTracker)
 * - Управление модальным окном настроек и полями ввода
 */

let currentTwitchChannel = "";
let viewerFeedLimit = (typeof MAX_LOG_LINES !== 'undefined') ? MAX_LOG_LINES : 20;
let avatarSize = DEFAULT_AVATAR_SIZE;
let onlyNewViewers = false;
let raidThreshold = DEFAULT_RAID_THRESHOLD;
let profileLoadTimer = null;
let profileQueueRunning = false;
let profileRefreshRequested = false;

function updateChannelDisplay(channel) {
    const el = document.getElementById('channel');
    if (el) {
        el.innerText = channel || '—';
    }
}

function applyAvatarSize() {
    document.documentElement.style.setProperty('--viewer-avatar-size', `${avatarSize}px`);
}

function trimViewerFeed() {
    const logDiv = document.getElementById('viewers');
    if (!logDiv) return;
    while (logDiv.children.length > viewerFeedLimit) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

function getVisibleUsernames() {
    const usernames = new Set();
    document.querySelectorAll('#viewers .line[data-username]').forEach((line) => {
        if (line.dataset && line.dataset.username) {
            usernames.add(line.dataset.username);
        }
    });
    return Array.from(usernames);
}

function showTwitchUser(type, user_name, css_class) {
    const logDiv = document.getElementById('viewers');
    if (!logDiv) return;

    const line = document.createElement('div');
    line.classList.add('line', css_class, 'just-added');
    const normalizedUsername = String(user_name).toLowerCase();
    line.dataset.username = normalizedUsername;
    const time = new Date().toLocaleTimeString('ru-RU');

    let last_element = logDiv.firstChild;
    if (last_element) last_element.classList.add('separated');

    line.innerHTML = `
        <div class="avatar">
            <img hidden>
        </div>
        <div class="info">
            <a class="nickname" href="https://twitch.tv/${encodeURIComponent(normalizedUsername)}" target="_blank" rel="noopener noreferrer"></a>
            <div class="stats">
                <div class="created_at"></div>
                <div class="followers"></div>
                <div class="average_viewers"></div>
            </div>
            <div class="last_stream"></div>
            <div class="bio"></div>
            <div class="datetime">${time}</div> 
            <div class="type">[${type}]</div> 
        </div>
        <div class="timer-bar"></div>
    `;

    const nicknameEl = line.querySelector('.nickname');
    if (nicknameEl) {
        nicknameEl.textContent = user_name;
        nicknameEl.href = `https://twitch.tv/${encodeURIComponent(normalizedUsername)}`;
    }
    const avatarImg = line.querySelector('.avatar img');
    if (avatarImg) avatarImg.alt = user_name;

    const timerBar = line.querySelector('.timer-bar');
    if (timerBar) {
        const recentDuration = getRecentViewerDuration();
        timerBar.style.animationDuration = `${recentDuration}s`;
        timerBar.addEventListener('animationend', () => {
            timerBar.remove();
            line.classList.remove('just-added');
        });
    }

    logDiv.prepend(line);
    trimViewerFeed();
    scheduleVisibleProfilesLoad();
}

function showRaidAlert(count) {
    const logDiv = document.getElementById('viewers');
    if (!logDiv) return;

    const line = document.createElement('div');
    line.classList.add('line', 'raid', 'special', 'just-added');
    const time = new Date().toLocaleTimeString('ru-RU');

    let last_element = logDiv.firstChild;
    if (last_element) last_element.classList.add('separated');

    line.innerHTML = `
        <div class="avatar raid-avatar">
            <div class="raid-icon">⚡</div>
        </div>
        <div class="info">
            <div class="nickname raid-title">Наплыв рейда: +${count} зрителей</div>
            <div class="bio">Защита от рейдов: зрители сохранены как временные и будут встречены как новые при следующем визите.</div>
            <div class="datetime">${time}</div>
            <div class="type">[RAID]</div>
        </div>
        <div class="timer-bar"></div>
    `;

    const timerBar = line.querySelector('.timer-bar');
    if (timerBar) {
        const recentDuration = getRecentViewerDuration();
        timerBar.style.animationDuration = `${recentDuration}s`;
        timerBar.addEventListener('animationend', () => {
            timerBar.remove();
            line.classList.remove('just-added');
        });
    }

    logDiv.prepend(line);
    trimViewerFeed();
}

function applyProfileToVisibleCards(username, userData) {
    if (!userData) return;

    document.querySelectorAll('#viewers .line[data-username]').forEach((line) => {
        if (line.dataset.username !== username) return;

        const image = line.querySelector('.avatar img');
        const nickname = line.querySelector('.nickname');
        const followers = line.querySelector('.followers');
        const avgViewersEl = line.querySelector('.average_viewers');
        const createdAtEl = line.querySelector('.created_at');
        const lastStreamEl = line.querySelector('.last_stream');
        const bio = line.querySelector('.bio');

        const rawLogin = (userData.login || username || '').toLowerCase();
        if (nickname) {
            nickname.textContent = userData.displayName || userData.login || username;
            if (rawLogin) {
                nickname.href = `https://twitch.tv/${encodeURIComponent(rawLogin)}`;
            }
        }

        if (followers) {
            const minFollowers = getMinFollowersThreshold();
            if (userData.followers !== undefined && userData.followers !== null && Number.isFinite(Number(userData.followers)) && Number(userData.followers) >= minFollowers) {
                const formattedFollowers = String(userData.followers);
                followers.innerHTML = `Фоловеров: <span class="count">${formattedFollowers}</span>`;
            } else {
                followers.innerHTML = '';
            }
        }

        if (avgViewersEl) {
            if (userData.avgViewers !== undefined && userData.avgViewers !== null && Number.isFinite(Number(userData.avgViewers)) && Number(userData.avgViewers) > 0) {
                const formattedAvg = String(userData.avgViewers);
                avgViewersEl.innerHTML = `Зрителей: <span class="count">${formattedAvg}</span>`;
            } else {
                avgViewersEl.innerHTML = '';
            }
        }

        if (createdAtEl) {
            const ageInfo = formatAccountAge(userData.createdAt);
            if (ageInfo && ageInfo.text) {
                const cssClass = ageInfo.isDanger ? 'danger' : 'normal';
                createdAtEl.classList.remove('danger', 'normal');
                createdAtEl.classList.add(cssClass);
                createdAtEl.innerHTML = `Возраст: <span class="count ${cssClass}">${ageInfo.text}</span>`;
            } else {
                createdAtEl.classList.remove('danger', 'normal');
                createdAtEl.innerHTML = '';
            }
        }

        if (lastStreamEl) {
            const streamTitle = (userData.lastBroadcast && typeof userData.lastBroadcast.title === 'string')
                ? userData.lastBroadcast.title.trim()
                : '';
            if (streamTitle) {
                lastStreamEl.innerHTML = `<span class="label">Стрим:</span> <span class="title"></span>`;
                const titleSpan = lastStreamEl.querySelector('.title');
                if (titleSpan) {
                    titleSpan.textContent = streamTitle;
                }
            } else {
                lastStreamEl.innerHTML = '';
            }
        }

        if (bio) {
            const userBio = (typeof userData.bio === 'string') ? userData.bio.trim() : '';
            if (userBio) {
                bio.innerHTML = `<span class="label">Инфо:</span> <span class="text"></span>`;
                const textSpan = bio.querySelector('.text');
                if (textSpan) {
                    textSpan.textContent = userBio;
                }
            } else {
                bio.innerHTML = '';
            }
        }

        if (userData.logo && image) {
            image.hidden = false;
            image.src = userData.logo;
            image.onerror = () => {
                image.hidden = true;
            };
        }
    });
}

function renderTestViewer(username = 'fra3a') {
    const testUsername = (typeof username === 'string' && username.trim()) ? username.trim() : 'fra3a';
    const userClass = isCoolUser(testUsername) ? 'special' : 'normal';
    showTwitchUser("JOIN", testUsername, userClass);
}

function scheduleVisibleProfilesLoad() {
    clearTimeout(profileLoadTimer);
    profileLoadTimer = setTimeout(() => {
        profileLoadTimer = null;
        profileRefreshRequested = true;
        processVisibleProfiles();
    }, PROFILE_LOAD_DELAY);
}

async function processVisibleProfiles() {
    if (profileQueueRunning) return;
    profileQueueRunning = true;

    try {
        do {
            profileRefreshRequested = false;
            const usernames = getVisibleUsernames();
            const cachedProfiles = await getCachedProfiles(usernames);
            const profilesToLoad = [];
            const now = Date.now();

            usernames.forEach((username) => {
                const cached = cachedProfiles.get(username);
                const isFresh = cached && (now - cached.fetchedAt < PROFILE_CACHE_TTL);
                const hasAvgViewersField = cached && cached.data && ('avgViewers' in cached.data);

                if (isFresh && hasAvgViewersField) {
                    applyProfileToVisibleCards(username, cached.data);
                } else {
                    profilesToLoad.push(username);
                }
            });

            for (let index = 0; index < profilesToLoad.length; index += PROFILE_BATCH_SIZE) {
                const visibleNow = new Set(getVisibleUsernames());
                const batch = profilesToLoad
                    .slice(index, index + PROFILE_BATCH_SIZE)
                    .filter((username) => visibleNow.has(username));

                if (batch.length === 0) continue;

                const [profiles, trackerResults] = await Promise.all([
                    getTwitchUsersData(batch).catch((err) => {
                        console.error("[UI/IVR] Ошибка IVR API:", err);
                        return new Map();
                    }),
                    Promise.all(batch.map((username) => fetchTwitchTrackerSummary(username)))
                ]);

                batch.forEach((username, idx) => {
                    const avgViewers = trackerResults[idx];
                    let profile = profiles.get(username);
                    if (profile) {
                        profile.avgViewers = avgViewers;
                    } else if (avgViewers !== null && avgViewers !== undefined) {
                        profile = { login: username, avgViewers };
                        profiles.set(username, profile);
                    } else {
                        profile = { login: username, avgViewers: null };
                        profiles.set(username, profile);
                    }
                });

                await cacheProfileBatch(batch, profiles);
                profiles.forEach((profile, username) => {
                    applyProfileToVisibleCards(username, profile);
                });
            }
        } while (profileRefreshRequested);
    } catch (error) {
        console.error("[UI] Ошибка загрузки данных пользователей:", error);
    } finally {
        profileQueueRunning = false;
        if (profileRefreshRequested) processVisibleProfiles();
    }
}

function initializeViewerSettings() {
    const channelInput = document.getElementById('twitchChannel');
    const feedLimitInput = document.getElementById('viewerFeedLimit');
    const avatarSizeInput = document.getElementById('avatarSize');
    const onlyNewInput = document.getElementById('onlyNewViewers');
    const raidThresholdInput = document.getElementById('raidThreshold');
    const coolUsersInput = document.getElementById('coolUsers');

    currentTwitchChannel = getTwitchChannel();
    viewerFeedLimit = readNumberSetting(VIEWER_FEED_LIMIT_KEY, (typeof MAX_LOG_LINES !== 'undefined') ? MAX_LOG_LINES : 20, 1, 500);
    avatarSize = readNumberSetting(AVATAR_SIZE_KEY, DEFAULT_AVATAR_SIZE, 32, 300);
    onlyNewViewers = readBooleanSetting(VIEWER_ONLY_NEW_KEY, false);
    raidThreshold = readNumberSetting(RAID_THRESHOLD_KEY, getRaidThreshold(), 2, 100);

    if (channelInput) channelInput.value = currentTwitchChannel;
    if (feedLimitInput) feedLimitInput.value = viewerFeedLimit;
    if (avatarSizeInput) avatarSizeInput.value = avatarSize;
    if (onlyNewInput) onlyNewInput.checked = onlyNewViewers;
    if (raidThresholdInput) raidThresholdInput.value = raidThreshold;
    if (coolUsersInput) coolUsersInput.value = getCoolUsersRaw();

    updateChannelDisplay(currentTwitchChannel);
    applyAvatarSize();

    if (channelInput) {
        channelInput.addEventListener('change', () => {
            const newChannel = channelInput.value.trim().replace(/^#/, '').trim().toLowerCase();
            channelInput.value = newChannel;
            if (newChannel === currentTwitchChannel) return;

            const prevChannel = currentTwitchChannel;
            currentTwitchChannel = newChannel;
            writeStringSetting(TWITCH_CHANNEL_KEY, currentTwitchChannel);
            updateChannelDisplay(currentTwitchChannel);

            if (!twitchClient) {
                if (currentTwitchChannel) {
                    startTwitchListener();
                }
            } else if (currentTwitchChannel) {
                if (prevChannel && typeof twitchClient.part === 'function') {
                    twitchClient.part(prevChannel).catch(console.warn);
                }
                if (typeof twitchClient.join === 'function') {
                    twitchClient.join(currentTwitchChannel).then(() => {
                        const statusEl = document.getElementById('status');
                        if (statusEl) {
                            statusEl.innerText = 'Online & Scanning';
                            statusEl.style.color = '#00ff41';
                        }
                    }).catch((err) => {
                        console.error("[Twitch] Ошибка переключения канала:", err);
                    });
                }
            } else {
                if (prevChannel && typeof twitchClient.part === 'function') {
                    twitchClient.part(prevChannel).catch(console.warn);
                }
                const statusEl = document.getElementById('status');
                if (statusEl) {
                    statusEl.innerText = 'Укажите канал в настройках';
                    statusEl.style.color = 'orange';
                }
            }
        });
    }

    if (onlyNewInput) {
        onlyNewInput.addEventListener('change', () => {
            onlyNewViewers = onlyNewInput.checked;
            writeBooleanSetting(VIEWER_ONLY_NEW_KEY, onlyNewViewers);
        });
    }

    if (raidThresholdInput) {
        raidThresholdInput.addEventListener('input', () => {
            const value = Number.parseInt(raidThresholdInput.value, 10);
            if (!Number.isFinite(value)) return;
            raidThreshold = Math.min(100, Math.max(2, value));
            writeNumberSetting(RAID_THRESHOLD_KEY, raidThreshold);
        });

        raidThresholdInput.addEventListener('change', () => {
            raidThreshold = clampNumber(raidThresholdInput.value, 2, 100, getRaidThreshold());
            raidThresholdInput.value = raidThreshold;
            writeNumberSetting(RAID_THRESHOLD_KEY, raidThreshold);
        });
    }

    if (feedLimitInput) {
        feedLimitInput.addEventListener('input', () => {
            const value = Number.parseInt(feedLimitInput.value, 10);
            if (!Number.isFinite(value)) return;
            viewerFeedLimit = Math.min(500, Math.max(1, value));
            writeNumberSetting(VIEWER_FEED_LIMIT_KEY, viewerFeedLimit);
            trimViewerFeed();
            scheduleVisibleProfilesLoad();
        });

        feedLimitInput.addEventListener('change', () => {
            viewerFeedLimit = clampNumber(feedLimitInput.value, 1, 500, (typeof MAX_LOG_LINES !== 'undefined') ? MAX_LOG_LINES : 20);
            feedLimitInput.value = viewerFeedLimit;
            writeNumberSetting(VIEWER_FEED_LIMIT_KEY, viewerFeedLimit);
            trimViewerFeed();
            scheduleVisibleProfilesLoad();
        });
    }

    if (avatarSizeInput) {
        avatarSizeInput.addEventListener('input', () => {
            const value = Number.parseInt(avatarSizeInput.value, 10);
            if (!Number.isFinite(value)) return;
            avatarSize = Math.min(300, Math.max(32, value));
            writeNumberSetting(AVATAR_SIZE_KEY, avatarSize);
            applyAvatarSize();
        });

        avatarSizeInput.addEventListener('change', () => {
            avatarSize = clampNumber(avatarSizeInput.value, 32, 300, DEFAULT_AVATAR_SIZE);
            avatarSizeInput.value = avatarSize;
            writeNumberSetting(AVATAR_SIZE_KEY, avatarSize);
            applyAvatarSize();
        });
    }

    if (coolUsersInput) {
        coolUsersInput.addEventListener('input', () => {
            writeStringSetting(COOL_USERS_KEY, coolUsersInput.value.trim());
        });

        coolUsersInput.addEventListener('change', () => {
            writeStringSetting(COOL_USERS_KEY, coolUsersInput.value.trim());
        });
    }

    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn && !saveBtn._hasSaveListener) {
        saveBtn._hasSaveListener = true;
        saveBtn.addEventListener('click', () => {
            if (channelInput) {
                const newChannel = channelInput.value.trim().replace(/^#/, '').trim().toLowerCase();
                writeStringSetting(TWITCH_CHANNEL_KEY, newChannel);
            }
            if (onlyNewInput) {
                writeBooleanSetting(VIEWER_ONLY_NEW_KEY, onlyNewInput.checked);
            }
            if (raidThresholdInput) {
                const threshold = clampNumber(raidThresholdInput.value, 2, 100, getRaidThreshold());
                writeNumberSetting(RAID_THRESHOLD_KEY, threshold);
            }
            if (feedLimitInput) {
                const limit = clampNumber(feedLimitInput.value, 1, 500, (typeof MAX_LOG_LINES !== 'undefined') ? MAX_LOG_LINES : 20);
                writeNumberSetting(VIEWER_FEED_LIMIT_KEY, limit);
            }
            if (avatarSizeInput) {
                const size = clampNumber(avatarSizeInput.value, 32, 300, DEFAULT_AVATAR_SIZE);
                writeNumberSetting(AVATAR_SIZE_KEY, size);
            }
            if (coolUsersInput) {
                writeStringSetting(COOL_USERS_KEY, coolUsersInput.value.trim());
            }
            reloadPage();
        });
    }

    initSettingsToggle();
}

function initSettingsToggle() {
    const toggleBtn = document.getElementById('settingsToggleBtn');
    const panelActions = document.querySelector('.panel-actions');
    if (toggleBtn && panelActions && !toggleBtn._hasToggleListener) {
        toggleBtn._hasToggleListener = true;
        toggleBtn.addEventListener('click', () => {
            panelActions.classList.toggle('is-open');
        });
    }
}
