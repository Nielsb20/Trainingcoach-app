#!/usr/bin/env python3
"""
Diagnostic helper: shows which fields Garmin actually returns for one day.

The fetch script reads fixed field names, and Garmin renames them from time to
time. Rather than guessing which name is current, this prints the real keys so
the mapping can be corrected once and for all.

Values are shown only for numeric/short fields — nothing sensitive is printed.
"""

import os
import sys
from datetime import date, timedelta

TOKEN_DIR = os.path.expanduser("~/.garminconnect")

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("garminconnect niet gevonden — draai met ./scripts/garmin-venv/bin/python")


def show(data, label, indent=0):
    prefix = "  " * indent
    if data is None:
        print(f"{prefix}{label}: geen antwoord")
        return
    if isinstance(data, list):
        print(f"{prefix}{label}: lijst met {len(data)} items")
        if data:
            show(data[0], f"{label}[0]", indent + 1)
        return
    if not isinstance(data, dict):
        print(f"{prefix}{label}: {type(data).__name__} = {str(data)[:60]}")
        return

    print(f"{prefix}{label}: {len(data)} velden")
    for key, value in sorted(data.items()):
        if isinstance(value, dict):
            print(f"{prefix}  {key}: (object met {len(value)} velden)")
            if indent < 2:
                show(value, key, indent + 2)
        elif isinstance(value, list):
            print(f"{prefix}  {key}: (lijst, {len(value)} items)")
        elif isinstance(value, (int, float)) and value is not None:
            print(f"{prefix}  {key} = {value}")
        elif value is None:
            print(f"{prefix}  {key} = None")
        else:
            print(f"{prefix}  {key} = {str(value)[:40]}")


email = os.environ.get("GARMIN_EMAIL") or input("Garmin e-mailadres: ")
import getpass
password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin wachtwoord: ")

print("\nInloggen...")
client = Garmin(email=email, password=password)
result = client.login()
if isinstance(result, tuple) and result and result[0] == "needs_mfa":
    client.resume_login(result[1], input("MFA-code: "))
print("Ingelogd.")

# Fill in the display name the same way the fetch script does
try:
    profile = client.get_user_profile()
    name = None
    if isinstance(profile, dict):
        for key in ("displayName", "profileId", "userName", "id"):
            if profile.get(key):
                name = str(profile[key])
                break
    if name:
        for attr in ("display_name", "displayName"):
            try:
                setattr(client, attr, name)
            except Exception:
                pass
        print(f"Weergavenaam ingesteld ({name[:8]}…)")
except Exception as err:
    print(f"(profiel niet opgehaald: {err})")

day = (date.today() - timedelta(days=1)).isoformat()
print(f"\nGegevens van {day}:")

endpoints = [
    ("get_stats", "dagstatistieken (rusthartslag, Body Battery, stress)"),
    ("get_user_summary", "dagsamenvatting (alternatief)"),
    ("get_rhr_day", "rusthartslag apart"),
    ("get_sleep_data", "slaap"),
    ("get_hrv_data", "HRV"),
    ("get_body_battery", "Body Battery apart"),
    ("get_stress_data", "stress apart"),
]

for method_name, label in endpoints:
    print()
    print("=" * 65)
    print(f"{method_name}() — {label}")
    print("=" * 65)
    method = getattr(client, method_name, None)
    if method is None:
        print("  (bestaat niet in deze versie van de bibliotheek)")
        continue
    try:
        show(method(day), method_name)
    except Exception as err:
        print(f"  FOUT: {type(err).__name__}: {str(err)[:120]}")
