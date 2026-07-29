# Studio CRM · Popular

| Вход | Статус |
|---|---|
| `popularpoet.pl` | взрослая студия · ЛК |
| Kids | **без домена** · вкладка админки · `/kids` |
| `populartickets.pl` | пробные + ивенты · P24 |
| `/admin` | вкладки Poet / Kids |

Saldeo: см. [`docs/SALDEO.md`](./docs/SALDEO.md) (по официальной Specyfikacja API 5.0.1).

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Demo: `anna@example.com` · `admin@studio.local` · `maria@example.com` (родитель) · `teacher@studio.local`

## Demo без ключей

| Сценарий | Как |
|---|---|
| Seed / reset | Admin → Seed · `POST /api/v1/demo/reset` |
| Дашборд дня | Admin пульт: кто придёт / риск отмены / закрыть |
| Kids пара | Ученики → «Kids: ребёнок + родитель» |
| Карточка ученика | `/admin/students/[id]` |
| Напомнить должникам | Пульт → inbox |
| Онбординг | `/pay` → magic-link → `/cabinet/welcome` |
| Persist | `.demo-data/state.json` (не слетает при рестарте) |
| Soft Kids | `/kids` |
| Smoke | `npm run dev` + `npm run smoke` |
