#!/usr/bin/env python3
"""
Diagnostic helper: shows where this version of the library keeps its session
tokens, so the fetch script can be pointed at the right place.

Only needed when saving the session fails. Prints attribute names and types,
never the token values themselves.
"""

import os
import sys

TOKEN_DIR = os.path.expanduser("~/.garminconnect")

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("garminconnect niet gevonden — draai dit met ./scripts/garmin-venv/bin/python")


def describe(obj, label, depth=0):
    prefix = "  " * depth
    print(f"{prefix}{label}: {type(obj).__module__}.{type(obj).__name__}")
    if depth >= 2:
        return
    interesting = [
        a for a in dir(obj)
        if not a.startswith("__")
        and any(k in a.lower() for k in ("token", "oauth", "dump", "save", "session", "client"))
    ]
    for name in interesting:
        try:
            value = getattr(obj, name)
        except Exception as err:
            print(f"{prefix}  .{name} -> niet leesbaar ({type(err).__name__})")
            continue
        if callable(value):
            print(f"{prefix}  .{name}() [methode]")
        elif value is None:
            print(f"{prefix}  .{name} = None")
        else:
            kind = type(value).__name__
            print(f"{prefix}  .{name} [{kind}]")
            if any(k in name.lower() for k in ("token", "oauth")) and depth < 2:
                methods = [m for m in ("model_dump", "dict", "_asdict", "to_dict")
                           if callable(getattr(value, m, None))]
                fields = [f for f in vars(value)] if hasattr(value, "__dict__") else []
                print(f"{prefix}     serialiseerbaar via: {methods or 'geen'}")
                print(f"{prefix}     velden: {fields[:8] or 'geen __dict__'}")


email = os.environ.get("GARMIN_EMAIL") or input("Garmin e-mailadres: ")
import getpass
password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin wachtwoord: ")

print("\nInloggen...")
client = Garmin(email=email, password=password)
result = client.login()
if isinstance(result, tuple) and result and result[0] == "needs_mfa":
    client.resume_login(result[1], input("MFA-code: "))
print("Ingelogd.\n")

print("=" * 60)
describe(client, "client")
for attr in ("garth", "garth_client"):
    nested = getattr(client, attr, None)
    if nested is not None:
        print()
        describe(nested, f"client.{attr}", depth=1)
        inner = getattr(nested, "client", None)
        if inner is not None:
            print()
            describe(inner, f"client.{attr}.client", depth=2)

print("=" * 60)
print("\nBeschikbare garth-versie:")
try:
    import garth
    print(f"  garth {getattr(garth, '__version__', 'onbekend')}")
    print(f"  module-functies: {[a for a in dir(garth) if a in ('save','dump','resume','client','Client')]}")
    gc = getattr(garth, "client", None)
    if gc is not None:
        print()
        describe(gc, "garth.client", depth=1)
except ImportError:
    print("  garth niet geïnstalleerd")
