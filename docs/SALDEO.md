# SaldeoSMART integration notes

Source: `SaldeoSMART - Specyfikacja API.md` (v5.0.1)

## Critical (2026)

- Minimum API version: **2.0**
- Prefer **3.0** for invoices: `POST /api/xml/3.0/invoice/add` (SSK06)

## Auth

Not Bearer. Each request:

| Param | Meaning |
|---|---|
| `username` | Saldeo login |
| `req_id` | unique request id |
| `req_sig` | `MD5( URL_ENCODING(sorted key=value…) + api_token )` |
| `company_program_id` | company mapping (required for invoice ops) |
| `command` | `base64(gzip(xml))` for POST bodies |

`api_token` is **never** sent — only used to sign.

## Invoice flow (our CRM)

1. User requests faktura in LK/admin  
2. We call **SSK06** `invoice/add`  
3. Wait ~30s (Saldeo generates PDF)  
4. Fetch meta/PDF via **SSK08** `invoice/listbyid`  
5. Store `saldeo_invoice_id`, number, `ksef_number`, `pdf_url`

## Endpoints we use

| Op | Path |
|---|---|
| Issue invoice | `/api/xml/3.0/invoice/add` |
| List by id | `/api/xml/3.0/invoice/listbyid` |

## Servers

- Prod: `https://saldeo.brainshare.pl`
- Test: `https://saldeo-test.brainshare.pl`

## Limits

- 20 req/min per user  
- No parallel requests for same user  

## Env

```
SALDEO_API_URL=https://saldeo.brainshare.pl
SALDEO_USERNAME=
SALDEO_API_TOKEN=
SALDEO_COMPANY_PROGRAM_ID=
```
