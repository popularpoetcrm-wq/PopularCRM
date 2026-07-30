#!/usr/bin/env python3
"""Parse payment signals from group sheets ($ price + $ markers) → JSON.

Legend (working hypothesis until studio confirms):
- Column «$» / price = размер абонемента (PLN / цикл)
- Имя с «$» на конце = текущий цикл оплачен
- В ячейках дат «$5» / «1$» = граница/факт оплаты цикла (считаем циклы)
- Лист «Абонемент» почти пуст — источник правды = колонки групп
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "Таблицы_реальные"
TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
NS = uuid.UUID(TENANT)
SKIP = {"абонемент"}


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, ":".join(parts)))


def as_price(v: object) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def as_size(v: object) -> bool:
    if v is None or isinstance(v, (int, float)):
        return False
    s = str(v).strip().upper().replace(" ", "").replace("М", "M").replace("Х", "X")
    return bool(re.fullmatch(r"X{0,3}S|X{0,2}M|X{0,3}L|[0-9]?X{0,2}[SML]", s))


def detect_has_size_col(ws) -> bool:
    b1 = ws.cell(1, 2).value
    if b1 is None:
        return False
    marker = str(b1).strip().upper()
    if marker in {"$", "ЦЕНА", "PRICE", "PLN"}:
        return False
    if marker in {"R", "SIZE", "РАЗМЕР", "ФУТБОЛКА"}:
        return True
    for row in ws.iter_rows(min_row=2, max_row=8, min_col=2, max_col=2, values_only=True):
        cell = row[0]
        if cell is None or cell == "":
            continue
        if as_size(cell):
            return True
        if as_price(cell) is not None:
            return False
    return False


def cell_has_pay_mark(v: object) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return "$" in s


def direction_key(title: str, sheet: str) -> str:
    blob = f"{title} {sheet}".lower()
    if "идея" in blob or re.search(r"\d\s*групп", blob):
        return "kids"
    if "импро" in blob:
        return "impro"
    if "актёр" in blob or "актер" in blob:
        return "acting"
    if "воскресн" in blob or "школ" in blob:
        return "school"
    if "спектакл" in blob:
        return "show"
    if "play" in blob:
        return "playback"
    return "other"


def parse_sheet(ws, *, brand: str, sheet_name: str, path_name: str) -> list[dict]:
    from parse_real_tables import name_key, clean_name

    has_size = False if brand == "kids" else detect_has_size_col(ws)
    out: list[dict] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        raw = row[0] if row else None
        key = name_key(raw)
        if not key:
            continue
        display = clean_name(raw) or key
        if display.casefold() in {"майки", "майка", "футболки", "импро", "имя", "name"}:
            continue

        if has_size:
            price = as_price(row[2] if len(row) > 2 else None)
            b_num = as_price(row[1] if len(row) > 1 else None)
            if price is None and b_num is not None and b_num <= 100 and not as_size(row[1]):
                continue
            date_start = 4
        else:
            price = as_price(row[1] if len(row) > 1 else None)
            date_start = 3

        raw_s = str(raw).strip()
        name_paid = raw_s.endswith("$")

        cycles = 0
        for cell in row[date_start:]:
            if cell_has_pay_mark(cell):
                cycles += 1
        if name_paid and cycles == 0:
            cycles = 1

        if price is None and cycles == 0:
            continue

        price = price or 0.0
        pid = uid("person", brand, key)
        gid = uid("group", brand, sheet_name)
        eid = uid("enroll", brand, sheet_name, key)
        paid_amount = round(price * cycles, 2) if cycles else 0.0
        due_amount = (
            round(price, 2)
            if cycles == 0 and price
            else round(price * max(cycles, 1), 2)
        )
        if cycles > 0:
            status = "paid"
            amount = paid_amount
            amount_paid = paid_amount
        else:
            status = "pending"
            amount = due_amount
            amount_paid = 0.0

        out.append(
            {
                "id": uid("payment", brand, sheet_name, key),
                "tenant_id": TENANT,
                "provider": "other",
                "provider_session_id": f"import:{brand}:{sheet_name}:{key}",
                "payer_person_id": pid,
                "enrollment_id": eid,
                "student_person_id": pid,
                "group_id": gid,
                "amount": amount,
                "amount_paid": amount_paid,
                "currency": "PLN",
                "status": status,
                "payment_method": "cash",
                "description": (
                    f"import {path_name}/{sheet_name} · {display} · "
                    f"price={price:g} · cycles={cycles}"
                ),
                "price_hint": price,
                "cycles": cycles,
                "name_paid_marker": name_paid,
                "full_name": display,
                "brand_id": brand,
                "source_sheet": sheet_name,
                "direction": direction_key(sheet_name, sheet_name),
            }
        )
    return out


def parse_file(path: Path, brand: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True)
    rows: list[dict] = []
    for sheet_name in wb.sheetnames:
        if sheet_name.lower() in SKIP:
            continue
        rows.extend(
            parse_sheet(
                wb[sheet_name],
                brand=brand,
                sheet_name=sheet_name,
                path_name=path.name,
            )
        )
    wb.close()
    return rows


def main() -> None:
    poet = TABLES / "Популярный поэт.xlsx"
    kids = TABLES / "Идея.xlsx"
    payments = []
    if poet.exists():
        payments.extend(parse_file(poet, "poet"))
    if kids.exists():
        payments.extend(parse_file(kids, "kids"))

    # dedupe by id
    by_id = {p["id"]: p for p in payments}
    payments = list(by_id.values())

    paid = [p for p in payments if p["status"] == "paid"]
    pending = [p for p in payments if p["status"] == "pending"]
    totals = {
        "payments": len(payments),
        "paid_rows": len(paid),
        "pending_rows": len(pending),
        "revenue_paid": round(sum(p["amount_paid"] for p in paid), 2),
        "debt_open": round(sum(p["amount"] - p["amount_paid"] for p in pending), 2),
        "avg_cycles_paid": round(
            sum(p["cycles"] for p in paid) / max(1, len(paid)), 2
        ),
    }

    out = {
        "phase": 3,
        "note": "Payments from group $ columns + $ attendance marks as cycles",
        "tenant_id": TENANT,
        "totals": totals,
        "payments": payments,
    }
    dest = ROOT / "scripts" / "data" / "real-tables-phase3-payments.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(dest), **totals}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
