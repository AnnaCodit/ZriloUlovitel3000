/**
 * Главная точка входа приложения «Зрилоуловитель 3000».
 * Связывает модули:
 *  - js/utils.js: Утилиты, настройки, валидаторы
 *  - js/db.js: IndexedDB база данных (viewers, profiles)
 *  - js/api.js: IVR API и TwitchTracker API
 *  - js/ui.js: Рендеринг интерфейса и настроек
 *  - js/twitch.js: TMI.js и детекция рейдов
 */

// Устанавливаем текущий канал и обновляем шапку
currentTwitchChannel = getTwitchChannel();
updateChannelDisplay(currentTwitchChannel);

// Инициализируем IndexedDB и запускаем рабочие процессы
initDatabase((database) => {
    initializeViewerSettings();
    startTwitchListener(); // Запускаем TMI только когда база данных готова

    updateNewViewersCount();
    setInterval(updateNewViewersCount, 60000);

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn && !clearBtn._hasClearListener) {
        clearBtn._hasClearListener = true;
        clearBtn.addEventListener('click', () => {
            if (!db) return;
            const stores = ["viewers", PROFILE_STORE_NAME];
            const tx = db.transaction(stores, "readwrite");
            stores.forEach((storeName) => tx.objectStore(storeName).clear());
            tx.oncomplete = () => {
                console.log("[IndexedDB] База данных зрителей и профилей очищена");
                updateNewViewersCount();
            };
        });
    }

    renderTestViewer();
});
