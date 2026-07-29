# Импорт реальных таблиц

Источник: `Таблицы_реальные/`

| Файл | Бренд | Смысл |
|------|--------|--------|
| `Популярный поэт.xlsx` | `poet` | Взрослые группы |
| `Идея.xlsx` | `kids` | Детские группы |

## Фаза 1 — группы и ученики

Группы + ученики + enrollments. Email нет → `onboarding_status = draft`, вход по magic-code пока недоступен.

```bash
.venv-xlsx/bin/python scripts/parse_real_tables.py
node scripts/import-real-tables.mjs
```

Артефакт: `scripts/data/real-tables-phase1.json`

## Фаза 2 — посещаемость

Даты из шапки → `sessions`, метки (`число`/`$n` → present, `-` → absent_notified, `*+` → present+makeup).

```bash
.venv-xlsx/bin/python scripts/parse_attendance.py
node scripts/import-attendance.mjs
```

Артефакт: `scripts/data/real-tables-phase2-attendance.json`

В админке: **Посещаемость** → выбрать дату (напр. `2026-07-28`).

## Дальше (по очереди)

3. Оплаты / лист «Абонемент»
4. Email родителей/учеников → инвайты в ЛК
