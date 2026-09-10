# Архитектура и локальные данные

```text
React UI → Express /api → OpenRouter
                    ├→ SQLite: задания и коллекции
                    ├→ локальные uploads/results
                    ├→ FFmpeg и ExifTool
                    └→ опциональный Cloudflare Media Worker → временный MP4 URL
```

Production frontend собирается Vite и обслуживается тем же Express-процессом. OpenRouter key существует только в окружении Node.js. Browser получает каталог моделей, capability-описания, задания и результаты, но не ключ.

## Данные

- `data/live` — live-задания, uploads и результаты;
- `data/demo` — изолированная demo-история;
- `data/library` — коллекции промптов;
- `data/logs` и `data/runtime` — launcher logs и временное состояние;
- `.env` — секреты и локальная конфигурация.

Все эти пути исключены из Git. Для резервной копии остановите Studio и скопируйте `.env` и всю папку `data`. Значение `DATA_DIR` позволяет хранить данные вне репозитория.

## Capability-driven слой

`server/provider.js` содержит OpenRouter HTTP-вызовы. `server/capabilities.js` нормализует каталог и повторно проверяет параметры на backend. Неполные сведения о references расширяются через `server/reference-overrides.json` с указанием источника.

## Сетевая граница

Обычный запуск слушает только loopback. API проверяет Host и Origin. Внешнему провайдеру можно отдавать только временные `/media/<uuid>` файлы. Media Worker принимает upload с отдельным bearer secret, ограничивает тип и размер, а KV удаляет объект по TTL.

Это однопользовательское приложение. Для общего интернет-сервера потребуются аккаунты, изоляция ключей и данных, rate limits, защита uploads и полноценная модель авторизации.
