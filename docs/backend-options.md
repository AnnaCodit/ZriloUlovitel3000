# Варианты серверной архитектуры для «Зрилоуловителя 3000»

В этом документе собраны и структурированы варианты перехода с локального браузерного хранилища (**IndexedDB**) на централизованный серверный бэкенд.

---

## Зачем переносить данные на сервер?
1. **Синхронизация между устройствами и окнами:** Один и тот же список зрителей и статистика доступны в браузере стримера, в OBS Browser Source на стрим-ПК, на втором мониторе или ноутбуке.
2. **Надежность хранения:** Данные не сотрутся при очистке куков/кэша браузера, переустановке системы или смене браузера.
3. **Общая аналитика:** Возможность строить глобальные графики притока аудитории по дням/неделям, собирать историю посещений и выгружать отчеты.
4. **Оповещения и интеграции:** Сервер может отправлять уведомления в Telegram/Discord при входе новых пользователей.

---

## Вариант 1: Serverless Edge (Cloudflare Workers + D1)

Полностью бессерверное решение, не требующее администрирования серверов и оплаты хостинга.

### Стек:
- **Cloudflare Pages:** Бесплатный хостинг статических файлов (`index.html`, `style.css`, `script.js`).
- **Cloudflare Workers:** Serverless JavaScript/TypeScript микро-бэкенд на CDN-серверах (отклик 10–30 мс).
- **Cloudflare D1:** Встроенная бессерверная реляционная SQL-база данных (SQLite).

### Как устроено:
1. Клиент в браузере перехватывает `join` через `tmi.js` и делает `fetch()` к Worker.
2. Worker исполняет SQL-запрос в D1:
   ```sql
   INSERT INTO viewers (username, first_seen)
   VALUES (?1, ?2)
   ON CONFLICT(username) DO NOTHING;
   ```
3. Worker возвращает `{ isNew: true/false, username: "..." }`.

### Пример кода Worker (`worker.js`):
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Обработка CORS для запросов из браузера
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Проверка / регистрация зрителя
    if (url.pathname === "/api/check-viewer" && request.method === "POST") {
      const { username } = await request.json();
      if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

      const cleanUser = username.toLowerCase().trim();
      const now = Date.now();

      const result = await env.DB.prepare(
        "INSERT INTO viewers (username, first_seen) VALUES (?1, ?2) ON CONFLICT(username) DO NOTHING"
      ).bind(cleanUser, now).run();

      const isNew = result.meta.changes > 0;
      return Response.json({ username: cleanUser, isNew, firstSeen: now }, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Статистика за 24 часа
    if (url.pathname === "/api/stats-24h" && request.method === "GET") {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const count = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM viewers WHERE first_seen >= ?1"
      ).bind(since).first("count");

      return Response.json({ count_24h: count }, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response("Not found", { status: 404 });
  }
};
```

### Бесплатные лимиты (Cloudflare Free):
- **Workers:** 100 000 вызовов в день.
- **D1:** 5 000 000 чтений и 100 000 записей в день (до 5 ГБ данных).
- **Плюсы:** 100% бесплатно, не требует поддержки Linux, максимальная отказоустойчивость.
- **Минусы:** Не подходит для постоянного серверного WebSocket-слушателя (Worker засыпает между запросами).

---

## Вариант 2: Классический PHP + MySQL (Виртуальный хостинг / VPS)

Идеальный вариант, если уже есть любой оплаченный PHP-хостинг (Beget, TimeWeb, cPanel и т.д.).

### Стек:
- **PHP 8.x** (один файл `api.php`).
- **MySQL / MariaDB** (с веб-интерфейсом phpMyAdmin).

### Структура таблицы:
```sql
CREATE TABLE viewers (
    username VARCHAR(50) PRIMARY KEY,
    first_seen BIGINT UNSIGNED NOT NULL,
    INDEX idx_first_seen (first_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Пример скрипта `api.php`:
```php
<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$pdo = new PDO('mysql:host=localhost;dbname=twitch_db;charset=utf8mb4', 'db_user', 'db_password', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
]);

$action = $_GET['action'] ?? 'check';

if ($action === 'check' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = strtolower(trim($input['username'] ?? ''));

    if (!$username) {
        http_response_code(400);
        echo json_encode(['error' => 'Username required']);
        exit;
    }

    $now = (int)(microtime(true) * 1000);

    // INSERT IGNORE вернет rowCount = 1 только если зритель добавлен впервые
    $stmt = $pdo->prepare("INSERT IGNORE INTO viewers (username, first_seen) VALUES (?, ?)");
    $stmt->execute([$username, $now]);
    $isNew = $stmt->rowCount() > 0;

    echo json_encode([
        'username'   => $username,
        'is_new'     => $isNew,
        'first_seen' => $now
    ]);
    exit;
}

if ($action === 'stats_24h') {
    $since = (int)(microtime(true) * 1000) - (24 * 60 * 60 * 1000);
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM viewers WHERE first_seen >= ?");
    $stmt->execute([$since]);
    echo json_encode(['count_24h' => (int)$stmt->fetchColumn()]);
    exit;
}
```

- **Плюсы:** Развертывание за 5 минут на любом хостинге, удобный phpMyAdmin для просмотра базы.
- **Минусы:** Требуется хостинг (100–200 руб/мес), если его еще нет.

---

## Вариант 3: BaaS — Backend-as-a-Service (PocketBase / Supabase)

Готовая серверная база данных с веб-админкой и официальным JavaScript SDK. Серверный код писать не нужно.

### Подварианты:
1. **PocketBase** (Self-hosted в 1 файл на VPS за $2–3/мес):
   - SQLite внутри, моментальный запуск.
   - Красивая встроенная панель управления для просмотра/удаления записей.
   - Работает из JS:
     ```javascript
     import PocketBase from 'pocketbase';
     const pb = new PocketBase('https://pb.yourdomain.com');

     try {
         await pb.collection('viewers').create({ username: 'alex', firstSeen: Date.now() });
         // Успешно создан -> новый зритель
     } catch (err) {
         // Ошибка дубликата ключа -> уже был
     }
     ```
2. **Supabase** (Облачный PostgreSQL):
   - Бесплатный тариф с таблицами, SQL-редактором и встроенным Realtime.

- **Плюсы:** Нулевой объем серверного кода, готовая визуальная админка.
- **Минусы:** Для PocketBase нужен VPS, для Supabase — зависимость от стороннего облака.

---

## Вариант 4: Серверный фоновый демон-слушатель (Node.js / Go + WebSockets)

Профессиональное решение для непрерывного отслеживания стрима.

### Как работает:
1. Серверный процесс (Node.js / Go / Python) работает **24/7** на VPS или контейнере (Render, Fly.io).
2. TMI-клиент запущен на сервере и постоянно слушает Twitch IRC.
3. Сервер сам пишет зрителей в БД (SQLite/PostgreSQL) и кеширует их профили (аватарки/био с IVR API).
4. Браузер и OBS-оверлеи подключаются к серверу через **WebSocket** или **Server-Sent Events (SSE)** и получают уже готовые события:
   ```json
   { "event": "NEW_VIEWER", "username": "alex", "avatar": "...", "bio": "..." }
   ```

- **Плюсы:**
  - Ни один зритель не будет пропущен, даже если OBS был выключен или вкладка перезагружалась.
  - Нулевая нагрузка на браузер стримера.
  - Кеширование Twitch/IVR API на стороне сервера исключает лимиты на клиенте.
- **Минусы:** Требуется сервер с постоянным аптаймом (Node.js демон под systemd / PM2 / Docker).

---

## Сравнительная таблица

| Параметр | Cloudflare (Workers + D1) | PHP + MySQL | PocketBase / Supabase | Node.js Демон |
| :--- | :--- | :--- | :--- | :--- |
| **Стоимость** | 100% бесплатно | Дешевый хостинг / VPS | Бесплатно (облако) или VPS $2–3 | VPS $2–5 / Render |
| **Сложность запуска** | Низкая (Wrangler / Панель) | Очень низкая (1 файл) | Очень низкая (готовый SDK) | Средняя (демон + WS) |
| **Админка для базы** | Веб-консоль D1 | phpMyAdmin | Готовая админка из коробки | Нужна своя или DBeaver |
| **Где слушается TMI** | В браузере | В браузере | В браузере | **На сервере (24/7)** |
| **Синхронизация OBS** | По запросу (REST) | По запросу (REST) | Realtime SDK | Realtime (WebSocket) |

---

## Рекомендации по выбору:
1. **Если нужен полностью бесплатный путь без забот о серверах:** **Вариант 1 (Cloudflare Pages + Workers + D1)**.
2. **Если уже есть классический хостинг:** **Вариант 2 (PHP + MySQL)**.
3. **Если важна наглядная веб-админка с минимальными усилиями:** **Вариант 3 (PocketBase)**.
4. **Если хочется максимальной автономности и защиты от потерь зрителей при перезапусках OBS:** **Вариант 4 (Node.js демон)**.
