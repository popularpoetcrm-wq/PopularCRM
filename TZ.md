# CRM театральной студии — короткое ТЗ

## Архитектура

**Одна система · нужные входы · одна админка**

| Вход | Домен | Назначение |
|---|---|---|
| Poet | `popularpoet.pl` | Взрослая студия: ЛК, пакеты, отработки |
| Kids | *пока без домена* | Детская линейка: вкладка в админке + soft path `/kids` |
| Tickets | `populartickets.pl` | Оплата **пробных** и **ивентов** (P24-bound) |

**Telegram** — оповещения + deep link  
**Админка** — одна, вкладки **Poet / Kids**  
**Фактуры** — SaldeoSMART API XML 3.0 (`invoice/add`) — см. `docs/SALDEO.md`

Стек: **Next.js 16 + React 19 + Tailwind 4 + Supabase + Przelewy24 + Telegram + Saldeo + Resend**

---

## Multi-brand правила

1. `brand_id`: `poet` | `kids` (операционка); `tickets` = checkout-домен
2. `product_kind`: `package` | `trial` | `event`
3. Пробные и ивенты → ссылки оплаты на **populartickets.pl**
4. Kids без public host — только админ-вкладка / `/kids`
5. Одна админка, фильтр по вкладке

---

## Ядро домена

1. Платёж → пакет → N credits  
2. Посещение списывает credit  
3. Пропуск → makeup credit  
4. Фактура on-request → Saldeo SSK06

## Посещаемость

1. По умолчанию клиент **придёт**, пока явно не нажал «Не приду»
2. «Не приду» позже чем за **6 часов** — поздно (кнопка недоступна)
3. Если в группе останется **1 человек** (меньше 2) — занятие **не проводится** / отменяется

## Онбординг

**Нет публичной саморегистрации.** `person` появляется только так:

1. Админ создал / CSV-импорт существующих
2. Checkout trial/event на `populartickets.pl` (матч по email)

Дальше клиент **активирует ЛК** по email magic-link. Telegram — привязка после входа (уведомления).

`onboarding_status`: `draft → invited → activated → complete`

| Кто | Как попадает |
|---|---|
| Существующие | Импорт/карточка → инвайт → welcome → опц. Telegram |
| Новые взрослые | Trial P24 → автоинвайт → пробное → оффер пакета **или** админ сразу в группу |
| Kids | Ребёнок `is_minor` не логинится; инвайт родителю |

Гибрид миграции: карточка всем; остаток credits/makeups — только кому актуально.

## UI

Liquid glass + brand themes (poet / kids / tickets).
