#!/usr/bin/env python3
"""
Controleert dat de sessie van Garmin bewaard kan worden.

Waarom dit bestaat: het opslaan van de sessie was stuk zonder dat iets dat
merkte. Elke automatische run moest daardoor opnieuw volledig inloggen, tot
Garmin het IP-adres begon te blokkeren met een 429 en de cron er helemaal mee
ophield. Het script meldde het wel, maar in een logbestand dat niemand las.

De oorzaak was subtiel: garminconnect 0.3.8 bewaart zijn garth-sessie op
`.client`, terwijl het script alleen naar `.garth` keek. De module-brede
`garth.save()` schreef daardoor lege bestanden — die slaat een andere,
niet-ingelogde instantie op.

Deze test bootst de vormen na waarin de bibliotheek zijn sessie kan aanbieden,
zodat een volgende versiewissel meteen zichtbaar wordt in plaats van pas als de
cron dagen stilstaat. Er is geen Garmin-account, netwerk of virtualenv voor
nodig; de bibliotheek wordt vervangen door een stub.

Draaien: npm run test:garmin (of python3 scripts/garmin-fetch.test.py)
"""
import importlib.util
import json
import os
import shutil
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_DIR = "/tmp/garmin-token-selftest"


def load_script():
    """Laadt garmin-fetch.py met een nagebootste garminconnect erachter."""
    stub = types.ModuleType("garminconnect")
    stub.Garmin = type("Garmin", (), {"__init__": lambda self, *a, **k: None})
    for name in ("GarminConnectAuthenticationError", "GarminConnectConnectionError",
                 "GarminConnectTooManyRequestsError"):
        setattr(stub, name, type(name, (Exception,), {}))
    sys.modules["garminconnect"] = stub
    sys.modules.setdefault("garth", types.ModuleType("garth"))

    spec = importlib.util.spec_from_file_location("garmin_fetch", os.path.join(HERE, "garmin-fetch.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.TOKEN_DIR = TOKEN_DIR
    return module


class GarthClient:
    """Zoals garth zijn sessie aanbiedt: tokens plus een dump()."""

    oauth1_token = {"oauth_token": "abc", "oauth_token_secret": "xyz"}
    oauth2_token = {"access_token": "tok", "expires_in": 3600}

    def dump(self, directory):
        os.makedirs(directory, exist_ok=True)
        for filename, token in (("oauth1_token.json", self.oauth1_token),
                                ("oauth2_token.json", self.oauth2_token)):
            with open(os.path.join(directory, filename), "w") as f:
                json.dump(token, f)


class TokensZonderDump:
    """Een sessie die de tokens wel heeft, maar geen dump() aanbiedt."""

    oauth1_token = {"oauth_token": "abc", "oauth_token_secret": "xyz"}
    oauth2_token = {"access_token": "tok", "expires_in": 3600}


def scenario(naam, client, gf):
    shutil.rmtree(TOKEN_DIR, ignore_errors=True)
    print(f"\n{naam}")
    assert gf.save_tokens(client), f"{naam}: de sessie had bewaard moeten worden"
    for filename in ("oauth1_token.json", "oauth2_token.json"):
        pad = os.path.join(TOKEN_DIR, filename)
        assert os.path.isfile(pad), f"{naam}: {filename} ontbreekt"
        assert os.path.getsize(pad) > 10, f"{naam}: {filename} is leeg — precies de fout die dit moet vangen"
    print("  ok  tokens weggeschreven en niet leeg")


def main():
    gf = load_script()

    # De vorm die op de Raspberry Pi draait.
    scenario("garminconnect 0.3.8 — sessie op .client",
             type("Garmin", (), {"__init__": lambda self: setattr(self, "client", GarthClient())})(), gf)

    # Oudere versies zetten hem op .garth; die moeten blijven werken.
    scenario("oudere versie — sessie op .garth",
             type("Garmin", (), {"__init__": lambda self: setattr(self, "garth", GarthClient())})(), gf)

    # Biedt de bibliotheek geen dump(), dan moeten de tokens alsnog gevonden worden.
    scenario("zonder dump() — handmatig vangnet",
             type("Garmin", (), {"__init__": lambda self: setattr(self, "client", TokensZonderDump())})(), gf)

    shutil.rmtree(TOKEN_DIR, ignore_errors=True)
    print("\nAlle Garmin-sessietests geslaagd.")


if __name__ == "__main__":
    main()
