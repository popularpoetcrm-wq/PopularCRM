#!/usr/bin/env python3
"""Parse Таблицы_реальные → JSON for Supabase import (phase 1: groups + students)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
except ImportError as e:
    raise SystemExit("Need openpyxl (use .venv-xlsx)") from e

ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "Таблицы_реальные"
TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
NS = uuid.UUID(TENANT)
PLAN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

SKIP_SHEETS = {
    "абонемент",  # payments — later phase
}

# Sheets in poet workbook that are kids-ish / special — still brand poet unless noted
WEEKDAY = {
    "пн": 1,
    "вт": 2,
    "ср": 3,
    "чт": 4,
    "пт": 5,
    "сб": 6,
    "вс": 0,
}

WEEKDAY_RU = {
    0: "Воскресенье",
    1: "Понедельник",
    2: "Вторник",
    3: "Среда",
    4: "Четверг",
    5: "Пятница",
    6: "Суббота",
}

DIRECTION_RU = {
    "impro": "Импровизация",
    "импро": "Импровизация",
    "импроверты": "Импровизация",
    "acting": "Актёрское мастерство",
    "актёрка": "Актёрское мастерство",
    "актерка": "Актёрское мастерство",
    "актёр": "Актёрское мастерство",
    "актер": "Актёрское мастерство",
    "show": "Спектакль",
    "спектакль": "Спектакль",
    "спектакл": "Спектакль",
    "playback": "Play-back",
    "play-back": "Play-back",
    "sunday_school": "Воскресная школа",
    "воскресная школа": "Воскресная школа",
}


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, ":".join(parts)))


def clean_name(raw: object) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # trailing $ = paid marker on name in some rows
    s = re.sub(r"\$+$", "", s).strip()
    if not s:
        return None
    return s


def as_date(v: object) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None


def as_price(v: object) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    if s in {"-", "—", ""}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def as_size(v: object) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None  # price leaked into size column
    s = str(v).strip().upper().replace(" ", "")
    if not s or s == "-":
        return None
    if re.fullmatch(r"[\d.,]+", s):
        return None
    # normalize latin/cyrillic M
    s = s.replace("М", "M").replace("Х", "X")
    if not re.fullmatch(r"X{0,3}S|X{0,2}M|X{0,3}L|[0-9]?X{0,2}[SML]", s):
        # allow common sizes only
        if s not in {"XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL"}:
            return None
    return s[:8]


def detect_has_size_col(ws) -> bool:
    """Poet sheets: B1='R' means size. B1='$' means price (no size), like Воскресная школа."""
    b1 = ws.cell(1, 2).value
    if b1 is None:
        return False
    marker = str(b1).strip().upper()
    if marker in {"$", "ЦЕНА", "PRICE", "PLN"}:
        return False
    if marker in {"R", "SIZE", "РАЗМЕР", "ФУТБОЛКА"}:
        return True
    # peek first data cells: size-like vs price-like
    for row in ws.iter_rows(min_row=2, max_row=8, min_col=2, max_col=2, values_only=True):
        cell = row[0]
        if cell is None or cell == "":
            continue
        if as_size(cell):
            return True
        if as_price(cell) is not None:
            return False
    return False


def normalize_direction(raw: str | None, sheet_name: str = "") -> str | None:
    blob = f"{raw or ''} {sheet_name}".lower()
    for key, label in DIRECTION_RU.items():
        if key in blob:
            return label
    if raw and raw.strip() and not re.fullmatch(r"[\d:.\-\s–]+", raw.strip()):
        # drop weekday-only headers like "Понедельник", "Пятница", "Суббота"
        if raw.strip().lower() in {v.lower() for v in WEEKDAY_RU.values()} | {
            "понедельник",
            "вторник",
            "среда",
            "четверг",
            "пятница",
            "суббота",
            "воскресенье",
            "четверг импро",
        }:
            return None
        return raw.strip()
    return None


def parse_time_range(blob: str) -> tuple[str | None, str | None, int]:
    """Return start HH:MM, end HH:MM, duration minutes."""
    compact = blob.replace(" ", "")
    # 18:00-20:00 / 11:30–13:30
    m = re.search(
        r"(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})",
        blob,
    )
    if m:
        h1, m1, h2, m2 = (int(x) for x in m.groups())
        start = f"{h1:02d}:{m1:02d}"
        end = f"{h2:02d}:{m2:02d}"
        dur = max(30, (h2 * 60 + m2) - (h1 * 60 + m1))
        return start, end, dur

    # 1800-2000 / 1830-2030
    m2 = re.search(r"(\d{3,4})\s*[-–]\s*(\d{3,4})", compact)
    if m2:
        a, b = m2.group(1), m2.group(2)
        if len(a) == 3:
            a = "0" + a
        if len(b) == 3:
            b = "0" + b
        start = f"{a[:2]}:{a[2:]}"
        end = f"{b[:2]}:{b[2:]}"
        dur = max(30, (int(b[:2]) * 60 + int(b[2:])) - (int(a[:2]) * 60 + int(a[2:])))
        return start, end, dur

    # single time 1900 or 19:00 → +2h default
    m3 = re.search(r"(?:^|[^\d])(\d{3,4})(?:[^\d]|$)", compact)
    if m3:
        a = m3.group(1)
        if len(a) == 3:
            a = "0" + a
        if len(a) == 4:
            h, mi = int(a[:2]), int(a[2:])
            if 0 <= h <= 23 and 0 <= mi <= 59:
                start = f"{h:02d}:{mi:02d}"
                end_m = h * 60 + mi + 120
                end = f"{end_m // 60:02d}:{end_m % 60:02d}"
                return start, end, 120
    m4 = re.search(r"(\d{1,2})[:.](\d{2})", blob)
    if m4:
        h, mi = int(m4.group(1)), int(m4.group(2))
        start = f"{h:02d}:{mi:02d}"
        end_m = h * 60 + mi + 120
        end = f"{end_m // 60:02d}:{end_m % 60:02d}"
        return start, end, 120

    return None, None, 90


def parse_schedule(sheet_name: str, header_a1: object) -> dict:
    name_l = sheet_name.lower()
    header = str(header_a1).strip() if header_a1 is not None else ""
    header_l = header.lower()

    weekday = None
    for key, num in WEEKDAY.items():
        if name_l.startswith(key) or re.search(rf"(^|[\s\-]){key}([\s\-]|$)", name_l):
            weekday = num
            break
    for word, num in (
        ("понедельник", 1),
        ("вторник", 2),
        ("сред", 3),
        ("четверг", 4),
        ("пятниц", 5),
        ("суббот", 6),
        ("воскрес", 0),
    ):
        if word in name_l or word in header_l:
            weekday = num
            break

    blob = f"{sheet_name} {header}"
    start_time, end_time, duration = parse_time_range(blob)

    direction_raw = header if header and not re.fullmatch(r"[\d:.\-\s–]+", header) else None
    # kids headers often "Четверг 16:00-17:30" / "Макс 15:00" — not a direction label
    if direction_raw and re.search(
        r"(понедельник|вторник|сред|четверг|пятниц|суббот|воскрес|\d{1,2}[:.]\d{2}|\d{3,4})",
        direction_raw.lower(),
    ):
        # keep only if clearly a course name without schedule noise... else None
        if not any(k in direction_raw.lower() for k in ("импро", "актёр", "актер", "спектакл", "play")):
            direction_raw = None
    direction = normalize_direction(direction_raw, sheet_name)

    return {
        "weekday": weekday,
        "start_time": start_time,
        "end_time": end_time,
        "duration_minutes": duration,
        "direction": direction,
    }


def format_time_range(sched: dict) -> str | None:
    start = sched.get("start_time")
    end = sched.get("end_time")
    if start and end:
        return f"{start}–{end}"
    if start:
        return start
    return None


def group_title(brand: str, sheet: str, header_a1: object, sched: dict) -> str:
    day = WEEKDAY_RU.get(sched["weekday"]) if sched.get("weekday") is not None else None
    time_part = format_time_range(sched)
    direction = sched.get("direction")

    if brand == "kids":
        # "1 группа" → группа 1
        m = re.search(r"(\d+)\s*групп", sheet.lower())
        group_no = m.group(1) if m else sheet.strip()
        bits = ["Идея"]
        if day:
            bits.append(day)
        if time_part:
            bits.append(time_part)
        title = " · ".join(bits)
        if m:
            title = f"{title} — группа {group_no}"
        elif direction and direction not in title:
            title = f"{title} — {direction}"
        # teacher hint from header like "Макс 15:00-16:30"
        header = str(header_a1).strip() if header_a1 else ""
        teacher = re.match(r"^([A-Za-zА-Яа-яЁё]+)\s+\d", header)
        if teacher and teacher.group(1).lower() not in {
            "четверг",
            "суббота",
            "понедельник",
            "вторник",
            "среда",
            "пятница",
            "воскресенье",
        }:
            title = f"{title} ({teacher.group(1)})"
        return title

    # poet: «Вторник 18:00–20:00 — Импровизация»
    head = " ".join(x for x in (day, time_part) if x)
    header = str(header_a1).strip() if header_a1 else ""
    # keep studio nickname when it adds meaning (Импроверты ≠ generic Импро)
    nickname = None
    if header and header.lower() not in {
        "импро",
        "импровизация",
        "актёрка",
        "актерка",
        "актёрское мастерство",
    }:
        if not re.fullmatch(r"[\d:.\-\s–]+", header) and header.lower() not in {
            v.lower() for v in WEEKDAY_RU.values()
        }:
            if "импроверт" in header.lower():
                nickname = "Импроверты"
            elif header.lower() in {"спектакль"} or direction == header:
                nickname = None
            elif direction and header.lower() not in direction.lower() and len(header) < 40:
                # e.g. "20:00-22:00" already stripped; keep short labels
                if not re.search(r"\d", header):
                    nickname = header

    label = direction
    if nickname and nickname != direction:
        label = f"{direction} · {nickname}" if direction else nickname

    if label and head:
        return f"{head} — {label}"
    if label:
        return label
    if head:
        return head
    return sheet.strip()


def parse_workbook(
    path: Path,
    brand: str,
    *,
    has_size_col: bool,
    is_minor: bool,
    skip: set[str] | None = None,
) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True)
    skip = {s.lower() for s in (skip or set())} | SKIP_SHEETS
    groups: list[dict] = []
    persons: dict[str, dict] = {}
    enrollments: list[dict] = []

    for sheet_name in wb.sheetnames:
        if sheet_name.lower() in skip:
            continue
        ws = wb[sheet_name]
        header_a1 = ws.cell(1, 1).value
        sched = parse_schedule(sheet_name, header_a1)
        gid = uid("group", brand, sheet_name)
        title = group_title(brand, sheet_name, header_a1, sched)
        groups.append(
            {
                "id": gid,
                "brand_id": brand,
                "title": title,
                "direction": sched.get("direction"),
                "source_sheet": sheet_name,
                "schedule": sched,
                "capacity": 16 if brand == "poet" else 12,
            }
        )

        # auto: size column if header B is R; Воскресная школа has B=$
        sheet_has_size = has_size_col if brand == "kids" else detect_has_size_col(ws)
        if brand == "kids":
            sheet_has_size = False

        # poet: A=name B=size C=price D=birthday  OR  A=name B=price C=birthday
        for row in ws.iter_rows(min_row=2, values_only=True):
            name = clean_name(row[0] if row else None)
            if not name:
                continue
            if sheet_has_size:
                size = as_size(row[1] if len(row) > 1 else None)
                price = as_price(row[2] if len(row) > 2 else None)
                bday = as_date(row[3] if len(row) > 3 else None)
            else:
                size = None
                price = as_price(row[1] if len(row) > 1 else None)
                bday = as_date(row[2] if len(row) > 2 else None)

            # stable person key within brand by display name
            pid = uid("person", brand, name.casefold())
            if pid not in persons:
                persons[pid] = {
                    "id": pid,
                    "full_name": name,
                    "birth_date": bday,
                    "tshirt_size": size,
                    "is_minor": is_minor,
                    "brand_hint": brand,
                    "source": path.name,
                }
            else:
                # fill missing attrs from later rows; never keep numeric "sizes"
                p = persons[pid]
                if p.get("tshirt_size") and not as_size(p["tshirt_size"]):
                    p["tshirt_size"] = None
                if not p.get("birth_date") and bday:
                    p["birth_date"] = bday
                if not p.get("tshirt_size") and size:
                    p["tshirt_size"] = size

            eid = uid("enroll", brand, sheet_name, name.casefold())
            # one enrollment per person/group (sheet may list same name twice)
            if not any(x["id"] == eid for x in enrollments):
                enrollments.append(
                    {
                        "id": eid,
                        "student_person_id": pid,
                        "group_id": gid,
                        "brand_id": brand,
                        "price_hint": price,
                        "tags": [f"price:{int(price)}"] if price else [],
                    }
                )

    return {
        "brand": brand,
        "file": path.name,
        "groups": groups,
        "persons": list(persons.values()),
        "enrollments": enrollments,
    }


def main() -> None:
    poet_path = TABLES / "Популярный поэт.xlsx"
    idea_path = TABLES / "Идея.xlsx"
    if not poet_path.exists() or not idea_path.exists():
        raise SystemExit(f"Missing xlsx in {TABLES}")

    poet = parse_workbook(
        poet_path,
        "poet",
        has_size_col=True,
        is_minor=False,
        skip={"абонемент"},  # keep Воскресная школа + Play-back as poet groups
    )
    # kids workbook has no size column
    kids = parse_workbook(
        idea_path,
        "kids",
        has_size_col=False,
        is_minor=True,
    )

    # Воскресная школа — детский формат в книге поэта
    for g in poet["groups"]:
        if "воскресная" in g["source_sheet"].lower():
            g["direction"] = "Воскресная школа"
            g["title"] = "Воскресенье — Воскресная школа"
            g["schedule"]["weekday"] = 0
            g["schedule"]["direction"] = "Воскресная школа"

    out = {
        "tenant_id": TENANT,
        "plan_id": PLAN_ID,
        "phase": 1,
        "note": "Phase 1: groups + persons + enrollments. No emails yet. Attendance/payments later.",
        "brands": {
            "poet": "Популярный поэт (взрослые)",
            "kids": "Идея (детские)",
        },
        "poet": poet,
        "kids": kids,
        "totals": {
            "poet_groups": len(poet["groups"]),
            "poet_persons": len(poet["persons"]),
            "poet_enrollments": len(poet["enrollments"]),
            "kids_groups": len(kids["groups"]),
            "kids_persons": len(kids["persons"]),
            "kids_enrollments": len(kids["enrollments"]),
        },
    }
    out_path = ROOT / "scripts" / "data" / "real-tables-phase1.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out["totals"], ensure_ascii=False, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
