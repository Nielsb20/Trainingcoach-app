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
import urllib.error
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


def _tokens_look_valid():
    """
    Checks the token files actually contain something.

    Existence alone isn't enough: garth's own dump() runs without error but
    writes empty files in the version we're stuck with, which meant the save
    step reported success while the next run failed to authenticate.
    """
    if not os.path.isdir(TOKEN_DIR):
        return False
    files = [f for f in os.listdir(TOKEN_DIR) if f.endswith(".json")]
    if not files:
        return False
    return any(os.path.getsize(os.path.join(TOKEN_DIR, f)) > 10 for f in files)


def _serialise(obj):
    """Turns a token object into something json.dump can handle."""
    for attr in ("model_dump", "dict", "_asdict"):
        method = getattr(obj, attr, None)
        if callable(method):
            try:
                return method()
            except Exception:
                pass
    if hasattr(obj, "__dict__") and obj.__dict__:
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    if isinstance(obj, dict):
        return obj
    return None


def _write_tokens_manually(client):
    """
    Last resort: read the tokens off the client and write them ourselves.

    garth was deprecated in March 2026 and its dump() silently produces empty
    files, so relying on the library to persist its own session no longer
    works. The tokens are still in memory after a successful login — this digs
    them out and writes the two files garth expects to read back.
    """
    holders = [client]
    for attr in ("garth", "garth_client"):
        nested = getattr(client, attr, None)
        if nested is not None:
            holders.append(nested)
            inner = getattr(nested, "client", None)
            if inner is not None:
                holders.append(inner)

    written = 0
    for holder in holders:
        for name, filename in (("oauth1_token", "oauth1_token.json"),
                               ("oauth2_token", "oauth2_token.json")):
            token = getattr(holder, name, None)
            if token is None:
                continue
            data = _serialise(token)
            if not data:
                continue
            try:
                os.makedirs(TOKEN_DIR, exist_ok=True)
                with open(os.path.join(TOKEN_DIR, filename), "w") as f:
                    json.dump(data, f, default=str)
                written += 1
            except Exception:
                continue
        if written:
            break

    return written > 0


def save_tokens(client):
    """
    Persists the session so the next run doesn't hit Garmin's login at all —
    which matters twice over: repeated logins trigger Garmin's rate limiting,
    and a cron job has no terminal to log in from.
    """
    candidates = [
        ("client.garth.dump", lambda: client.garth.dump(TOKEN_DIR)),
        ("client.dump", lambda: client.dump(TOKEN_DIR)),
        ("client.garth_client.dump", lambda: client.garth_client.dump(TOKEN_DIR)),
        ("client.garth.client.dump", lambda: client.garth.client.dump(TOKEN_DIR)),
        ("garth.save", lambda: __import__("garth").save(TOKEN_DIR)),
        ("client.garth.save", lambda: client.garth.save(TOKEN_DIR)),
        ("handmatig wegschrijven", lambda: _write_tokens_manually(client)),
    ]

    problems = []
    for name, attempt in candidates:
        # Clear anything a previous attempt left behind, so an empty file from
        # one method can't be mistaken for a success by the next check.
        if os.path.isdir(TOKEN_DIR):
            for f in os.listdir(TOKEN_DIR):
                if f.endswith(".json"):
                    try:
                        os.remove(os.path.join(TOKEN_DIR, f))
                    except OSError:
                        pass

        try:
            attempt()
        except (AttributeError, ImportError) as err:
            problems.append(f"{name}: {type(err).__name__}")
            continue
        except Exception as err:
            problems.append(f"{name}: {err}")
            continue

        if _tokens_look_valid():
            print(f"Tokens opgeslagen in {TOKEN_DIR} via {name} (je wachtwoord wordt niet bewaard).")
            return True
        problems.append(f"{name}: bestanden bleven leeg")

    print()
    print("WAARSCHUWING: de sessie kon niet bruikbaar worden opgeslagen.")
    print("  Gevolg: de automatische taak kan niet inloggen en elke run vraagt")
    print("  opnieuw om je wachtwoord — wat het risico op blokkades vergroot.")
    print("  Geprobeerd:")
    for p in problems:
        print(f"    - {p}")
    print()
    print("  De garth-bibliotheek is sinds maart 2026 niet meer onderhouden; dit is")
    print("  daar een gevolg van. Je kunt het script gewoon handmatig blijven draaien.")
    print()
    return False


def is_rate_limited(err):
    text = str(err).lower()
    return "429" in text or "rate limit" in text or "too many requests" in text


def login():
    """Logs in, reusing cached tokens when possible so we don't hammer Garmin's login."""
    if not _tokens_look_valid():
        print("Geen bruikbare opgeslagen sessie gevonden; nieuwe login nodig.")
    else:
        try:
            client = Garmin()
            client.login(TOKEN_DIR)
            print("Ingelogd met opgeslagen tokens (geen nieuwe login nodig).")
            return client
        except Exception as err:
            # Worth reporting: a fresh login is the step that can hit Garmin's
            # rate limiting, so knowing it's coming explains a later failure.
            print(f"Opgeslagen sessie werkte niet ({type(err).__name__}); nieuwe login nodig.")

    # A cron job has no terminal, so prompting would raise EOFError and the run
    # would fail every single night. Say plainly what's wrong instead.
    if not sys.stdin.isatty():
        fail(
            "geen opgeslagen Garmin-sessie gevonden en er is geen terminal om naar in te loggen.",
            "Log eerst een keer handmatig in; daarna werkt de automatische taak op de bewaarde tokens:\n"
            "        cd ~/Trainingcoach-app/trainingscoach-server\n"
            "        npm run garmin -- --days 3",
        )

    email = os.environ.get("GARMIN_EMAIL") or input("Garmin e-mailadres: ")
    password = os.environ.get("GARMIN_PASSWORD")
    if not password:
        import getpass
        password = getpass.getpass("Garmin wachtwoord: ")

    try:
        try:
            client = Garmin(email=email, password=password, return_on_mfa=True)
            result = client.login()
        except TypeError:
            # Older releases don't accept return_on_mfa
            client = Garmin(email, password)
            result = client.login()

        # Newer library versions signal MFA by returning a tuple
        if isinstance(result, tuple) and result and result[0] == "needs_mfa":
            code = input("MFA-code uit je authenticator-app: ")
            client.resume_login(result[1], code)

        print("Ingelogd bij Garmin.")
        save_tokens(client)  # a failure here is a nuisance, not fatal
        return client

    except Exception as err:
        if is_rate_limited(err):
            fail(
                "Garmin heeft je IP-adres tijdelijk geblokkeerd (429).",
                "Dit is hun botbeveiliging, niet iets in deze code. Wacht een uur en probeer opnieuw.\n"
                "      Probeer NIET herhaaldelijk in te loggen - dat verlengt de blokkade.\n"
                "      Intussen kun je je gegevens gewoon handmatig invoeren bij Herstel in de app.",
            )
        fail(
            f"inloggen bij Garmin mislukt: {err}",
            "Als dit plotseling begon te falen, heeft Garmin waarschijnlijk zijn login gewijzigd.\n"
            "      Probeer: ./scripts/garmin-venv/bin/pip install --upgrade garminconnect\n"
            "      Werkt dat niet, voer je gegevens dan handmatig in via de app.",
        )


# Some failures are the same account-level problem repeated for every single
# day. Reporting them once, at the end, keeps the output readable.
_reported_problems = set()


def safe(fn, label):
    """Garmin's endpoints fail independently; one missing metric shouldn't abort the run."""
    try:
        return fn()
    except Exception as err:
        message = str(err)
        if "display name" in message.lower():
            _reported_problems.add(
                "display_name:Je Garmin-profiel heeft geen weergavenaam. Daardoor blijven "
                "rusthartslag, Body Battery en stress leeg.\n"
                "      Oplossen: ga naar https://connect.garmin.com, open je profielinstellingen "
                "en vul een weergavenaam in."
            )
        else:
            key = f"{label}:{message[:60]}"
            if key not in _reported_problems:
                _reported_problems.add(key)
                print(f"  (kon {label} niet ophalen: {err})")
        return None


def report_problems():
    """Prints account-level problems once, after the per-day output."""
    grouped = [p.split(":", 1)[1] for p in _reported_problems if p.startswith("display_name:")]
    if grouped:
        print()
        print("LET OP: " + grouped[0])


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
    except urllib.error.HTTPError as err:
        # The server answered, so "can't reach the server" would be misleading.
        # Show what it actually said — that's what points at the real problem.
        try:
            detail = json.loads(err.read() or "{}")
            detail = detail.get("details") or detail.get("error") or ""
        except Exception:
            detail = ""
        fail(f"de server wees {path} af (HTTP {err.code}){': ' + detail if detail else ''}.",
             "De server draait dus wel. Controleer of hij de laatste versie draait:\n"
             "        cd ~/Trainingcoach-app && git pull && pm2 restart trainingscoach")
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

    report_problems()
    print(f"\nGevonden: {len(entries)} dagen welzijnsdata, {len(weights)} gewichtsmetingen")

    if args.dry_run:
        print(json.dumps({"wellness": entries, "weights": weights}, indent=2))
        return

    if entries:
        result = post("/api/wellness/bulk", {"entries": entries})
        print(f"Welzijnsdata verstuurd: {result}")

    sent = 0
    for w in weights:
        try:
            post("/api/weight-logs", w)
            sent += 1
        except SystemExit:
            # post() already explained the problem; keep going so one bad
            # measurement doesn't discard the rest.
            print(f"  (gewichtsmeting van {w['date']} overgeslagen)")
    if weights:
        print(f"{sent} van {len(weights)} gewichtsmetingen verstuurd.")

    print("\nKlaar. Klik in de app op 'Ververs gegevens' om ze te zien.")


if __name__ == "__main__":
    main()
