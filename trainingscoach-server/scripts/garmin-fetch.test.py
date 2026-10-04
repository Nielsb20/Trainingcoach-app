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


def nachthartslag_tests(gf):
    """
    De nachthartslag moet uit de slaapreeks komen, niet uit Garmin's dagveld.

    Waarom dit bestaat: restingHeartRate is een DAGwaarde — de laagste
    aanhoudende hartslag over het hele etmaal. Lees je hem 's ochtends af, dan
    gaat hij over de nacht; lig je 's middags een uur stil, dan is het 's
    avonds dát getal. Hetzelfde veld, dezelfde dag, een ander antwoord. Een
    herstelbasislijn die daarop steunt beweegt om redenen die niets met
    herstel te maken hebben.
    """
    print("\nnachthartslag")

    # De vorm die garminconnect normaal teruggeeft.
    reeks = [{"startGMT": i, "value": v} for i, v in enumerate([50] * 30 + [54] * 30)]
    assert gf.overnight_heart_rate({"sleepHeartRate": reeks}) == 52, "gemiddelde over het slaapvenster"

    # Een andere versie van de bibliotheek levert paren in plaats van dicts.
    paren = [[i, 48] for i in range(40)]
    assert gf.overnight_heart_rate({"heartRateValues": paren}) == 48, "paren moeten ook gelezen worden"

    # Gaten en onzinwaarden tussen de metingen tellen niet mee.
    rommel = [{"value": None}, {"value": 0}, {"value": 400}] + [{"value": 46} for _ in range(25)]
    assert gf.overnight_heart_rate({"sleepHeartRate": rommel}) == 46, "None en onmogelijke waarden eruit"

    # Een halve nacht is geen nacht: liever niets dan een getal uit vijf metingen.
    assert gf.overnight_heart_rate({"sleepHeartRate": [{"value": 46}] * 5}) is None
    assert gf.overnight_heart_rate({}) is None
    assert gf.overnight_heart_rate(None) is None
    print("  ok  gemiddelde over het slaapvenster, in beide vormen, met te weinig metingen als None")

    # Terugval op de dagreeks: alleen het stuk binnen de nacht, en alleen als
    # het slaapvenster bekend is — zonder dat is het de dagwaarde waar we juist
    # vanaf wilden.
    venster = (1000, 2000)
    dagreeks = {"heartRateValues":
                [[500, 80]] * 30            # overdag, moet buiten blijven
                + [[1000 + i, 47] for i in range(30)]
                + [[5000, 75]] * 30}
    assert gf.overnight_uit_dagreeks(dagreeks, venster) == 47, "alleen de metingen binnen de nacht"
    assert gf.overnight_uit_dagreeks(dagreeks, None) is None, "zonder slaapvenster geen nachtwaarde"
    print("  ok  terugval op de dagreeks blijft binnen het slaapvenster")

    slaap = {"dailySleepDTO": {"sleepStartTimestampGMT": 1000, "sleepEndTimestampGMT": 2000}}
    assert gf.slaapvenster(slaap) == (1000, 2000)
    assert gf.slaapvenster({"dailySleepDTO": {}}) is None
    assert gf.slaapvenster({"dailySleepDTO": {"sleepStartTimestampGMT": 2000,
                                              "sleepEndTimestampGMT": 1000}}) is None
    print("  ok  een slaapvenster dat niet klopt wordt niet gebruikt")


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

    nachthartslag_tests(gf)
    print("\nAlle Garmin-tests geslaagd.")


if __name__ == "__main__":
    main()
