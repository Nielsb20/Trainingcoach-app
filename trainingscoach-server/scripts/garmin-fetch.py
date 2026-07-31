#!/usr/bin/env python3
"""
Optional Garmin Connect fetcher — gewicht, rusthartslag, HRV en slaap.

WAAROM PYTHON EN NIET NODE
--------------------------
Garmin heeft in maart 2026 zijn authenticatie gewijzigd, waardoor vrijwel het
hele onofficiële ecosysteem brak. De JavaScript-bibliotheken zijn afgeleid van
`garth`, dat sindsdien niet meer onderhouden wordt. Alleen python-garminconnect
is hersteld, door de login te herbouwen bovenop curl_cffi (dat de officiële
Android-app nabootst op TLS-niveau).

WAT DIT BETEKENT
----------------
Dit script is het brooste onderdeel van de hele applicatie. Het kan zonder
aankondiging stoppen met werken als Garmin opnieuw iets wijzigt. Daarom staat
het bewust los: valt dit om, dan blijft alles eromheen gewoon werken en voer je
je gegevens handmatig of via een CSV-export in.

Er is geen officieel alternatief: Garmin's Health API vereist goedkeuring als
bedrijf en wijst persoonlijk gebruik af.

INSTALLEREN (op de Pi)
----------------------
    sudo apt install -y python3-pip python3-venv
    cd ~/Trainingcoach-app/trainingscoach-server/scripts
    python3 -m venv garmin-venv
    ./garmin-venv/bin/pip install garminconnect

GEBRUIK
-------
    ./garmin-venv/bin/python garmin-fetch.py --days 7

Bij de eerste keer vraagt hij om je Garmin-inloggegevens (en een MFA-code als
je die hebt ingesteld). Daarna worden alleen tokens bewaard in ~/.garminconnect,
niet je wachtwoord.

Het script stuurt de opgehaalde gegevens naar de lokale API van deze server;
het schrijft zelf niet in de database.
"""

import argparse
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

SERVER_URL = os.environ.get("TRAININGSCOACH_URL", "http://localhost:3001")
TOKEN_DIR = os.path.expanduser("~/.garminconnect")


def fail(message, hint=None):
    print(f"FOUT: {message}", file=sys.stderr)
    if hint:
        print(f"      {hint}", file=sys.stderr)
    sys.exit(1)


try:
    from garminconnect import Garmin
except ImportError:
    fail(
        "de bibliotheek 'garminconnect' is niet geïnstalleerd.",
        "Installeer met: ./garmin-venv/bin/pip install garminconnect",
    )


def login():
    """Logs in, reusing cached tokens when possible so we don't hammer Garmin's login."""
    try:
        client = Garmin()
        client.login(TOKEN_DIR)
        print("Ingelogd met opgeslagen tokens.")
        return client
    except Exception:
        pass  # no valid cached session — fall through to a fresh login

    email = os.environ.get("GARMIN_EMAIL") or input("Garmin e-mailadres: ")
    password = os.environ.get("GARMIN_PASSWORD")
    if not password:
        import getpass
        password = getpass.getpass("Garmin wachtwoord: ")

    try:
        client = Garmin(email=email, password=password, return_on_mfa=True)
        result = client.login()
        # Newer library versions signal MFA by returning a tuple
        if isinstance(result, tuple) and result[0] == "needs_mfa":
            code = input("MFA-code uit je authenticator-app: ")
            client.resume_login(result[1], code)
        client.garth.dump(TOKEN_DIR)
        print(f"Ingelogd. Tokens opgeslagen in {TOKEN_DIR} (je wachtwoord wordt niet bewaard).")
        return client
    except Exception as err:
        fail(
            f"inloggen bij Garmin mislukt: {err}",
            "Als dit plotseling begon te falen, heeft Garmin waarschijnlijk zijn login gewijzigd. "
            "Probeer 'pip install --upgrade garminconnect'; werkt dat niet, voer je gegevens dan "
            "voorlopig handmatig in via de app.",
        )


def safe(fn, label):
    """Garmin's endpoints fail independently; one missing metric shouldn't abort the run."""
    try:
        return fn()
    except Exception as err:
        print(f"  (kon {label} niet ophalen: {err})")
        return None


def collect(client, day):
    """Gathers one day of wellness data. Returns None when nothing usable came back."""
    iso = day.isoformat()
    entry = {"date": iso, "source": "garmin"}

    stats = safe(lambda: client.get_stats(iso), "dagstatistieken")
    if stats:
        entry["restingHr"] = stats.get("restingHeartRate")
        entry["bodyBatteryMax"] = stats.get("bodyBatteryHighestValue")
        entry["bodyBatteryMin"] = stats.get("bodyBatteryLowestValue")
        entry["stressAvg"] = stats.get("averageStressLevel")

    sleep = safe(lambda: client.get_sleep_data(iso), "slaapgegevens")
    if sleep:
        daily = sleep.get("dailySleepDTO") or {}
        seconds = daily.get("sleepTimeSeconds")
        if seconds:
            entry["sleepMinutes"] = round(seconds / 60)
        scores = daily.get("sleepScores") or {}
        overall = scores.get("overall") or {}
        if overall.get("value") is not None:
            entry["sleepScore"] = overall["value"]

    hrv = safe(lambda: client.get_hrv_data(iso), "HRV")
    if hrv:
        summary = hrv.get("hrvSummary") or {}
        if summary.get("lastNightAvg") is not None:
            entry["hrvMs"] = summary["lastNightAvg"]

    # Only worth sending if at least one real metric came back
    has_data = any(entry.get(k) is not None for k in
                   ["restingHr", "hrvMs", "sleepMinutes", "sleepScore", "bodyBatteryMax", "stressAvg"])
    return entry if has_data else None


def collect_weight(client, start, end):
    """Body composition from an Index scale, if present."""
    data = safe(lambda: client.get_body_composition(start.isoformat(), end.isoformat()), "gewicht")
    if not data:
        return []
    out = []
    for item in data.get("dateWeightList", []):
        # Garmin reports weight in grams
        grams = item.get("weight")
        if not grams:
            continue
        entry = {
            "id": f"garmin-{item.get('samplePk') or item.get('date')}",
            "date": (item.get("calendarDate") or "")[:10],
            "weight_kg": round(grams / 1000, 1),
        }
        if item.get("bodyFat") is not None:
            entry["body_fat_pct"] = round(item["bodyFat"], 1)
        if entry["date"]:
            out.append(entry)
    return out


def post(path, payload):
    req = urllib.request.Request(
        f"{SERVER_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or "{}")
    except Exception as err:
        fail(f"kon de server niet bereiken op {SERVER_URL}{path}: {err}",
             "Draait de Trainingscoach-server? Controleer met: pm2 status")


def main():
    parser = argparse.ArgumentParser(description="Haalt Garmin-welzijnsgegevens op en stuurt ze naar Trainingscoach.")
    parser.add_argument("--days", type=int, default=7, help="aantal dagen terug (standaard 7)")
    parser.add_argument("--dry-run", action="store_true", help="alleen tonen, niets versturen")
    args = parser.parse_args()

    client = login()

    end = date.today()
    start = end - timedelta(days=args.days - 1)

    print(f"\nOphalen van {start} t/m {end}...")
    entries = []
    for offset in range(args.days):
        day = start + timedelta(days=offset)
        print(f"  {day}")
        entry = collect(client, day)
        if entry:
            entries.append(entry)

    weights = collect_weight(client, start, end)

    print(f"\nGevonden: {len(entries)} dagen welzijnsdata, {len(weights)} gewichtsmetingen")

    if args.dry_run:
        print(json.dumps({"wellness": entries, "weights": weights}, indent=2))
        return

    if entries:
        result = post("/api/wellness/bulk", {"entries": entries})
        print(f"Welzijnsdata verstuurd: {result}")

    for w in weights:
        post("/api/weight-logs", w)
    if weights:
        print(f"{len(weights)} gewichtsmetingen verstuurd.")

    print("\nKlaar. Klik in de app op 'Ververs gegevens' om ze te zien.")


if __name__ == "__main__":
    main()
