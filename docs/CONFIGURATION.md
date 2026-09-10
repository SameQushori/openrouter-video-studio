# Конфигурация

Все настройки backend читаются из локального `.env`. После изменения перезапустите Studio.

| Переменная | Обязательность | Назначение |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | В live-режиме | Личный ключ OpenRouter. Никогда не добавляйте его в переменные `VITE_*`. |
| `DEMO_MODE` | Нет | `true` включает изолированный тест без OpenRouter и списаний. |
| `PORT` | Нет | Локальный порт, по умолчанию `3001`. |
| `HOST` | Нет | Адрес прослушивания, по умолчанию `127.0.0.1`. Для Docker используется `0.0.0.0`, но порт публикуется только локально. |
| `DATA_DIR` | Нет | Папка истории, коллекций, uploads и результатов. По умолчанию `data`. |
| `MEDIA_WORKER_URL` | Для локальных MP4 | Адрес собственного Cloudflare Media Worker. |
| `MEDIA_WORKER_TOKEN` | Вместе с Worker URL | Отдельный случайный секрет загрузки. Это не OpenRouter key. |
| `PUBLIC_ASSET_BASE_URL` | Альтернатива Worker | Публичный HTTPS origin, который обслуживает только `/media/*`. |
| `AUTO_PUBLIC_MEDIA_TUNNEL` | Нет | Временный Quick Tunnel через установленный `cloudflared`. |
| `OPENROUTER_PROXY_URL` | Нет | Локальный HTTP proxy, например `http://127.0.0.1:10809`. Принимается только loopback-адрес. |
| `VPN_APP_PATH` | Только Windows, необязательно | Приложение VPN/proxy, которое может запустить PowerShell launcher. |

Минимальный live-конфиг:

```dotenv
OPENROUTER_API_KEY=ваш_ключ
DEMO_MODE=false
PORT=3001
HOST=127.0.0.1
DATA_DIR=data
```

Проверить конфигурацию можно без сетевого запроса:

```sh
npm run doctor
```

### TikTok

Импорт TikTok является необязательным. На Windows `setup-tiktok.ps1` устанавливает `tools/yt-dlp.exe`; файл исключён из Git. На macOS/Linux установите актуальный `yt-dlp` в `PATH`. Доступны только публичные ролики, а работа зависит от ограничений TikTok.

### Обновление

Перед обновлением остановите Studio и выполните `npm run backup`. Ключ храните отдельно: автоматическая копия намеренно не включает `.env`. После обновления выполните `npm ci`, `npm run build` и `npm run doctor`. Setup не перезаписывает существующий `.env` и пользовательские коллекции.
