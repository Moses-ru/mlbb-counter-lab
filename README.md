# MLBB Counter Lab

Фан-сайт по Mobile Legends: Bang Bang для себя и друзей: тир-лист, билды против конкретного героя, контрпики, синергии, тренды и профиль игрока с историей матчей.

Сайт: https://moses-ru.github.io/mlbb-counter-lab/

## Как устроено

- `mlbb/index.html` — весь сайт (одна страница, без зависимостей).
- `mlbb/data.json`, `mlbb/img.json` — статистика и иконки, их собирает `mlbb/tools/update.mjs`.
- `mlbb/tools/build.mjs` — собирает папку `dist/` для GitHub Pages.
- `.github/workflows/pages.yml` — каждый день в 07:00 по Москве собирает свежую статистику, сохраняет её в репозиторий и публикует сайт. Запустить вручную: вкладка **Actions** → «Обновление и публикация сайта» → **Run workflow**.

## Локально

```bash
node mlbb/tools/update.mjs   # свежая статистика
node mlbb/tools/serve.mjs    # http://localhost:8765
```

## Данные

Статистика и вход в профиль — через неофициальный API [Rone Arena](https://arena.rone.dev) (данные Moonton Academy).
Проект не связан с Moonton. Mobile Legends: Bang Bang и все игровые изображения принадлежат Moonton.
