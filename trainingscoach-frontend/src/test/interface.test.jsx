import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ErrorBoundary from "../components/shared/ErrorBoundary";
import CollapsibleCard from "../components/shared/CollapsibleCard";
import RestTimer from "../components/shared/RestTimer";
import WorkoutFilePanel from "../components/shared/WorkoutFilePanel";
import GearMapping from "../components/shared/GearMapping";
import KrachtTab from "../components/KrachtTab";
import EventsTab from "../components/EventsTab";
import SchemaTab from "../components/SchemaTab";
import WellnessTab from "../components/WellnessTab";
import PlannerTab from "../components/PlannerTab";
import CardioTab from "../components/CardioTab";
import App from "../App";
import { herstelOverzicht } from "../lib/recovery";
import { NAV } from "../lib/constants";
import * as api from "../api/client";

/**
 * Smoketests voor de interface.
 *
 * Alle vijfendertig testbestanden zaten aan de serverkant, terwijl de helft van
 * de regels in de interface staat. Wat hier wordt vastgelegd is niet de opmaak
 * maar het gedrag dat stukgaat zonder dat je het merkt: een tabblad dat niet
 * meer rendert, een timer die twee keer los loopt, een formulier dat je invoer
 * stil laat vallen.
 */

describe("ErrorBoundary", () => {
  function Boom() {
    throw new Error("kapot bij het tekenen");
  }

  it("houdt de rest van de app overeind als een scherm vastloopt", () => {
    // React logt de fout zelf ook; dat hoeft de testuitvoer niet te vervuilen.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary resetKey="schema">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Dit scherm liep vast/)).toBeInTheDocument();
    expect(screen.getByText(/kapot bij het tekenen/)).toBeInTheDocument();
    // Belangrijkste belofte: er staat nog iets, en je kunt verder.
    expect(screen.getByRole("button", { name: /Pagina herladen/ })).toBeInTheDocument();
  });

  it("geeft een nieuw tabblad een schone kans", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="schema">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Dit scherm liep vast/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="kracht">
        <p>ander tabblad</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("ander tabblad")).toBeInTheDocument();
    expect(screen.queryByText(/Dit scherm liep vast/)).not.toBeInTheDocument();
  });
});

describe("CollapsibleCard", () => {
  it("onthoudt of je hem open had staan", () => {
    const { unmount } = render(
      <CollapsibleCard id="test-blok" title="Meting toevoegen">
        <p>formulier</p>
      </CollapsibleCard>
    );
    expect(screen.queryByText("formulier")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Meting toevoegen/ }));
    expect(screen.getByText("formulier")).toBeInTheDocument();
    unmount();

    // Opnieuw gemonteerd, bijvoorbeeld na een tabwissel: nog steeds open.
    render(
      <CollapsibleCard id="test-blok" title="Meting toevoegen">
        <p>formulier</p>
      </CollapsibleCard>
    );
    expect(screen.getByText("formulier")).toBeInTheDocument();
  });

  it("valt terug op de standaard als opslag geweigerd wordt", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    render(
      <CollapsibleCard id="geen-opslag" title="Blok" defaultOpen>
        <p>inhoud</p>
      </CollapsibleCard>
    );
    // Geen crash, en de standaard wordt gerespecteerd.
    expect(screen.getByText("inhoud")).toBeInTheDocument();
  });
});

describe("RestTimer", () => {
  it("laat de grote timer en de setknop dezelfde rust aftellen", async () => {
    render(
      <div>
        <RestTimer />
        <RestTimer compact />
      </div>
    );

    // De compacte knop toont de gekozen rusttijd zolang er niets loopt.
    const compact = screen.getByTitle(/Rust van 90 seconden starten/);
    expect(compact).toHaveTextContent("90s");

    fireEvent.click(compact);

    // Eén gedeelde timer: dezelfde tijd staat op beide plekken. Waren het losse
    // timers, dan zou de grote nog op 1:30 staan wachten terwijl het knopje telt.
    await waitFor(() => {
      expect(screen.getAllByText(/^1:(2\d|30)$/)).toHaveLength(2);
    });
  });
});

describe("KrachtTab", () => {
  const schema = {
    days: [{ id: "d1", name: "Dag A", exercises: [{ id: "e1", name: "Squat", targetSets: 2, targetReps: 5 }] }],
    cardioDays: [],
    profile: {},
  };

  beforeEach(() => {
    vi.spyOn(api, "getPlannedSessions").mockResolvedValue({ plans: [] });
  });

  it("toont het coachadvies voor de dag die je logt", async () => {
    api.getPlannedSessions.mockResolvedValue({
      plans: [
        {
          id: "p1",
          date: new Date().toISOString().slice(0, 10),
          type: "Dag A",
          description: "Squat 3x5 op 102,5 kg",
          status: "gepland",
          discipline: "kracht",
        },
      ],
    });

    render(<KrachtTab schema={schema} workoutLogs={[]} addWorkoutLog={vi.fn()} goToSchema={vi.fn()} />);

    expect(await screen.findByText(/Wat de coach voor deze training adviseert/)).toBeInTheDocument();
    expect(screen.getByText(/102,5 kg/)).toBeInTheDocument();
  });

  it("blijft bruikbaar als de planning niet op te halen is", async () => {
    api.getPlannedSessions.mockRejectedValue(new Error("server plat"));
    render(<KrachtTab schema={schema} workoutLogs={[]} addWorkoutLog={vi.fn()} goToSchema={vi.fn()} />);

    // Loggen moet altijd kunnen; advies is een extraatje.
    expect(await screen.findByText("Squat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Training opslaan/ })).toBeInTheDocument();
  });

  it("slaat alleen sets op die je hebt ingevuld", async () => {
    const addWorkoutLog = vi.fn().mockResolvedValue(true);
    render(<KrachtTab schema={schema} workoutLogs={[]} addWorkoutLog={addWorkoutLog} goToSchema={vi.fn()} />);

    const numbers = await screen.findAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "100" } }); // set 1 gewicht
    fireEvent.change(numbers[1], { target: { value: "5" } });   // set 1 reps
    fireEvent.click(screen.getByRole("button", { name: /Training opslaan/ }));

    await waitFor(() => expect(addWorkoutLog).toHaveBeenCalled());
    const entry = addWorkoutLog.mock.calls[0][0];
    expect(entry.exercises).toHaveLength(1);
    expect(entry.exercises[0].sets).toEqual([{ weight: 100, reps: 5 }]);
  });

  it("zet de gewichten van de coach klaar en slaat alleen afgevinkte sets op", async () => {
    api.getPlannedSessions.mockResolvedValue({
      plans: [{
        id: "p1", date: new Date().toISOString().slice(0, 10), type: "Dag A",
        description: "Squat 3x5 op 102,5 kg", status: "gepland", discipline: "kracht",
        krachtDoelen: [{ naam: "Squat", sets: 3, herhalingen: 5, gewichtKg: 102.5 }],
      }],
    });
    const addWorkoutLog = vi.fn().mockResolvedValue(true);
    render(<KrachtTab schema={schema} workoutLogs={[]} addWorkoutLog={addWorkoutLog} goToSchema={vi.fn()} />);

    // Drie sets volgens de coach, niet de twee uit het schema, en echt ingevuld.
    await waitFor(() => expect(screen.getAllByLabelText(/Squat set \d gewicht/)).toHaveLength(3));
    expect(screen.getByLabelText("Squat set 1 gewicht")).toHaveValue(102.5);
    expect(screen.getByLabelText("Squat set 1 herhalingen")).toHaveValue(5);

    fireEvent.click(screen.getByRole("button", { name: "Squat set 1 gedaan" }));
    fireEvent.click(screen.getByRole("button", { name: "Squat set 2 gedaan" }));
    fireEvent.click(screen.getByRole("button", { name: /Training opslaan/ }));

    await waitFor(() => expect(addWorkoutLog).toHaveBeenCalled());
    // Set 3 stond alleen klaar en is niet getild: die hoort niet in het log.
    expect(addWorkoutLog.mock.calls[0][0].exercises[0].sets).toEqual([
      { weight: 102.5, reps: 5 }, { weight: 102.5, reps: 5 },
    ]);
  });

  it("valt zonder coachadvies terug op de vorige keer", async () => {
    const vorige = [{ id: "w1", date: "2026-10-01", exercises: [{ name: "Squat", sets: [{ weight: 95, reps: 5 }, { weight: 97.5, reps: 4 }] }] }];
    render(<KrachtTab schema={schema} workoutLogs={vorige} addWorkoutLog={vi.fn()} goToSchema={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Squat set 2 gewicht")).toHaveValue(97.5));
    expect(screen.getByLabelText("Squat set 1 gewicht")).toHaveValue(95);
  });
});

describe("EventsTab", () => {
  const events = [
    { id: "e1", name: "HBO Fietstocht", date: "2099-08-21", type: "Wielerevenement", target: "uitrijden", notes: "" },
  ];

  it("laat een evenement bewerken zonder het opnieuw aan te maken", async () => {
    const updateEvent = vi.fn().mockResolvedValue(true);
    render(<EventsTab events={events} addEvent={vi.fn()} updateEvent={updateEvent} deleteEvent={vi.fn()} />);

    fireEvent.click(screen.getByTitle("Dit evenement bewerken"));
    fireEvent.change(screen.getByPlaceholderText(/Marathon Rotterdam/), { target: { value: "HBO Fietstocht 2026" } });
    fireEvent.click(screen.getByRole("button", { name: /Opslaan/ }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    // Het id blijft: coachantwoorden en geplande sessies verwijzen ernaar.
    expect(updateEvent.mock.calls[0][0]).toBe("e1");
    expect(updateEvent.mock.calls[0][1].name).toBe("HBO Fietstocht 2026");
  });
});

describe("WorkoutFilePanel", () => {
  const plan = {
    id: "p1",
    type: "Fietsen",
    description: "2x20 min op drempel",
    status: "gepland",
    discipline: "cardio",
    structuur: null,
  };

  it("toont de blokken met echte downloadlinks als ze er al liggen", async () => {
    const metStructuur = {
      ...plan,
      structuurBron: "coach",
      structuur: [
        { soort: "warmup", minuten: 10, pctFtp: 55, pctFtpTot: 75 },
        { soort: "interval", herhalingen: 2, aanMinuten: 20, uitMinuten: 10, aanPctFtp: 95, uitPctFtp: 55 },
      ],
    };
    render(<WorkoutFilePanel plan={metStructuur} onChanged={vi.fn()} />);

    expect(screen.getByText(/Warm-up 10 min van 55% naar 75% FTP/)).toBeInTheDocument();
    expect(screen.getByText(/2x 20 min op 95% FTP/)).toBeInTheDocument();

    // Echte links, geen knoppen met ophaalcode: op een tablet naast de trainer
    // laat een blob-download het nogal eens afweten.
    const zwo = screen.getByRole("link", { name: /Download .zwo/ });
    expect(zwo).toHaveAttribute("href", expect.stringContaining("/planned/p1/trainingsbestand?formaat=zwo"));
    expect(zwo).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: ".erg" })).toBeInTheDocument();
    // De import in ROUVY is handwerk, dus er moet staan waar je het neerzet.
    expect(screen.getByText(/Workouts → Add your own workout/)).toBeInTheDocument();
  });

  it("slaat een omgezet voorstel pas op als je het bevestigt", async () => {
    vi.spyOn(api, "derivePlannedStructure").mockResolvedValue({
      blokken: [{ soort: "duur", minuten: 60, pctFtp: 70 }],
      toelichting: "Eén duurblok van een uur.",
      samenvatting: { totaalMinuten: 60, regels: [] },
    });
    vi.spyOn(api, "savePlannedStructure").mockResolvedValue({});
    render(<WorkoutFilePanel plan={plan} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Maak een trainingsbestand/ }));
    expect(await screen.findByText(/nog niet opgeslagen/i)).toBeInTheDocument();
    expect(screen.getByText(/Eén duurblok van een uur/)).toBeInTheDocument();
    // Niets opgeslagen zolang er niet is bevestigd: een bestand dat iets anders
    // voorschrijft dan je planning merk je pas halverwege een interval.
    expect(api.savePlannedStructure).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Alleen vastleggen/ }));
    await waitFor(() => expect(api.savePlannedStructure).toHaveBeenCalled());
    expect(api.savePlannedStructure.mock.calls[0][1]).toEqual([{ soort: "duur", minuten: 60, pctFtp: 70 }]);
  });

  it("meldt het als er geen blokken uit te halen zijn", async () => {
    vi.spyOn(api, "derivePlannedStructure").mockRejectedValue(new Error("Hier is geen blokkenstructuur uit te halen."));
    render(<WorkoutFilePanel plan={plan} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Maak een trainingsbestand/ }));
    expect(await screen.findByText(/geen blokkenstructuur uit te halen/)).toBeInTheDocument();
  });

  it("laat de werkelijke reden zien als het omzetten mislukt", async () => {
    // "Omzetten mislukt" zonder meer liet niemand zien of de API-sleutel
    // ontbrak of dat het model iets onbruikbaars terugstuurde.
    vi.spyOn(api, "derivePlannedStructure").mockRejectedValue(
      new Error("Omzetten mislukt — GEMINI_API_KEY ontbreekt in .env. Dit is een instelling op de server, geen fout in de training.")
    );
    render(<WorkoutFilePanel plan={plan} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Maak een trainingsbestand/ }));
    expect(await screen.findByText(/GEMINI_API_KEY ontbreekt/)).toBeInTheDocument();
  });
});

describe("GearMapping", () => {
  beforeEach(() => {
    // Het blok leest ook hoe de Garmin-profielen bedoeld zijn; zonder die
    // mock valt het hele component om op een netwerkfout.
    vi.spyOn(api, "getStravaSportTypeMeaning").mockResolvedValue({ betekenis: "fiets" });
  });

  it("koppelt een fiets en meldt hoeveel historie is bijgewerkt", async () => {
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [
        { id: "b999", naam: "Santa Cruz Hightower", fiets: null, aantalRitten: 3, inStrava: true },
      ],
      zonderMateriaal: 0,
    });
    vi.spyOn(api, "setStravaGearSubType").mockResolvedValue({ id: "b999", fiets: "mtb", bijgewerkt: 3 });

    render(<GearMapping />);
    expect(await screen.findByText("Santa Cruz Hightower")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mtb" } });

    await waitFor(() => expect(api.setStravaGearSubType).toHaveBeenCalledWith("b999", "mtb"));
    // De hele winst van deze koppeling zit in die terugwerkende kracht, dus
    // dat moet je ook te zien krijgen.
    expect(await screen.findByText(/3 eerdere sessies meteen bijgewerkt/)).toBeInTheDocument();
  });

  it("laat schoenen met rust en geeft ze geen fietstype", async () => {
    // Schoenen en fietsen zitten in dezelfde Strava-lijst. Een paar ASICS een
    // fietstype laten kiezen is onzin die bovendien niets doet, want de
    // koppeling raakt alleen fietssessies.
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [
        { id: "b1", naam: "Cube Agree pro 2026", fiets: null, aantalRitten: 23, sport: "Fietsen", inStrava: false },
        { id: "g1", naam: "ASICS GP 2000", fiets: null, aantalRitten: 5, sport: "Hardlopen", inStrava: false },
      ],
      zonderMateriaal: 0, zonderMateriaalPerBron: [], verouderd: 0, vanStravaOpgehaald: 0,
    });
    render(<GearMapping />);

    expect(await screen.findByText("ASICS GP 2000")).toBeInTheDocument();
    expect(screen.getByText(/hardloopschoenen — geen fietstype/)).toBeInTheDocument();
    // Alleen de fiets krijgt een keuzelijst, niet de schoenen.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("biedt aan het materiaal op te halen voor ritten die het missen", async () => {
    // "Geen fiets hier" is iets anders dan "geen fiets in Strava". Dat
    // verschil was de verwarring: in Strava hangt er wel een fiets onder, hij
    // is alleen nooit deze kant op gekomen omdat de rit uit een CSV kwam.
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [{ id: "b1", naam: "Cube Agree pro 2026", fiets: "racefiets", aantalRitten: 23, sport: "Fietsen", inStrava: false }],
      zonderMateriaal: 294,
      zonderMateriaalPerBron: [{ source: "csv_import", aantal: 294 }],
      verouderd: 0, vanStravaOpgehaald: 0,
    });
    vi.spyOn(api, "backfillStravaGear").mockResolvedValue({
      bekeken: 300, gekoppeld: 287, zonderMatch: 13, paginas: 2, gelabeld: 287,
    });
    render(<GearMapping />);

    expect(await screen.findByText(/294 fietssessies hebben hier nog geen fiets/)).toBeInTheDocument();
    expect(screen.getByText(/csv_import: 294/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Materiaal ophalen uit Strava/ }));
    await waitFor(() => expect(api.backfillStravaGear).toHaveBeenCalled());
    expect(await screen.findByText(/287 sessies hebben nu hun materiaal/)).toBeInTheDocument();
    // Wat niet te matchen was hoort erbij: anders klopt het aantal niet en
    // vraag je je af waar de rest bleef.
    expect(screen.getByText(/13 activiteiten uit Strava hoorden bij geen enkele sessie/)).toBeInTheDocument();
  });

  it("wijst naar het bijwerken als de fietsen nog uit je historie moeten komen", async () => {
    // Het normale geval vlak na een update: ritten zijn geïmporteerd voordat
    // de fiets werd bewaard. Een leeg vak zonder uitleg laat je dan gissen of
    // het stuk is.
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [], zonderMateriaal: 12, verouderd: 493, vanStravaOpgehaald: 0,
    });
    render(<GearMapping />);
    expect(await screen.findByText(/Nog geen fietsen bekend/)).toBeInTheDocument();
    expect(screen.getByText("493")).toBeInTheDocument();
    expect(screen.getByText(/Analysedata bijwerken/)).toBeInTheDocument();
  });

  it("zegt zonder verouderde ritten dat er in Strava geen fiets aan hangt", async () => {
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [], zonderMateriaal: 3, verouderd: 0, vanStravaOpgehaald: 0,
    });
    render(<GearMapping />);
    expect(await screen.findByText(/per sessie in het detailscherm/)).toBeInTheDocument();
    expect(screen.queryByText(/Analysedata bijwerken/)).not.toBeInTheDocument();
  });
});

describe("Betekenis van het Garmin-profiel", () => {
  it("laat je kiezen of het profiel de fiets of de ondergrond aangeeft", async () => {
    vi.spyOn(api, "getStravaGear").mockResolvedValue({
      materiaal: [{ id: "b1", naam: "Santa Cruz", fiets: "mtb", aantalRitten: 5, inStrava: true }],
      zonderMateriaal: 0, verouderd: 0, vanStravaOpgehaald: 1,
    });
    vi.spyOn(api, "getStravaSportTypeMeaning").mockResolvedValue({ betekenis: "fiets" });
    vi.spyOn(api, "setStravaSportTypeMeaning").mockResolvedValue({ betekenis: "ondergrond" });

    render(<GearMapping />);
    const opOndergrond = await screen.findByRole("radio", { name: /Op waar ik rijd/ });
    expect(screen.getByRole("radio", { name: /Op de fiets waar ik op zit/ })).toBeChecked();

    fireEvent.click(opOndergrond);
    await waitFor(() => expect(api.setStravaSportTypeMeaning).toHaveBeenCalledWith("ondergrond"));
    // Belangrijk dat dit erbij staat: de keuze verandert niets aan wat er al ligt.
    expect(await screen.findByText(/Geldt vanaf de volgende synchronisatie/)).toBeInTheDocument();
  });
});

describe("Volgorde van oefeningen", () => {
  const schema = {
    days: [{
      id: "d1", name: "Dag A", weekdays: [], exercises: [
        { id: "e1", name: "Squat", targetSets: 3, targetReps: 5 },
        { id: "e2", name: "Bench press", targetSets: 3, targetReps: 8 },
        { id: "e3", name: "Roeien", targetSets: 3, targetReps: 10 },
      ],
    }],
    cardioDays: [],
    profile: {},
  };

  beforeEach(() => {
    vi.spyOn(api, "getBackups").mockResolvedValue({ backups: [], laatste: null });
    vi.spyOn(api, "getGoals").mockResolvedValue({});
    vi.spyOn(api, "getAutomation").mockResolvedValue({});
  });

  it("schuift een oefening omhoog en laat de rest staan", async () => {
    const setSchema = vi.fn();
    render(<SchemaTab schema={schema} setSchema={setSchema} />);

    fireEvent.click(await screen.findByLabelText("Roeien een plek omhoog"));

    expect(setSchema).toHaveBeenCalled();
    const namen = setSchema.mock.calls[0][0].days[0].exercises.map((e) => e.name);
    expect(namen).toEqual(["Squat", "Roeien", "Bench press"]);
  });

  it("laat de randen met rust", async () => {
    const setSchema = vi.fn();
    render(<SchemaTab schema={schema} setSchema={setSchema} />);

    // De eerste kan niet omhoog en de laatste niet omlaag; dat hoort niet als
    // een klikbare knop te ogen die vervolgens niets doet.
    expect(await screen.findByLabelText("Squat een plek omhoog")).toBeDisabled();
    expect(screen.getByLabelText("Roeien een plek omlaag")).toBeDisabled();
    expect(screen.getByLabelText("Squat een plek omlaag")).not.toBeDisabled();
  });
});

describe("Navigatie", () => {
  it("geeft elk tabblad een naam, ook als het label om ruimte wegvalt", async () => {
    vi.spyOn(api, "loadAll").mockResolvedValue({
      schema: { days: [], cardioDays: [], profile: {} },
      workoutLogs: [], cardioLogs: [], weightLogs: [], events: [], coachHistory: [],
    });
    vi.spyOn(api, "getPlannedSessions").mockResolvedValue({ plans: [] });
    vi.spyOn(api, "getBackups").mockResolvedValue({ backups: [], laatste: null });
    vi.spyOn(api, "getGoals").mockResolvedValue({});
    vi.spyOn(api, "getAutomation").mockResolvedValue({});

    render(<App />);

    // Op een telefoon stonden de labels op display:none. Dat haalt ze ook uit
    // de toegankelijkheidsboom, dus de negen knoppen hadden geen naam meer —
    // niet voor een schermlezer en niet voor een tooltip. De naam hoort op de
    // knop zelf te staan, los van of het label zichtbaar is.
    for (const n of NAV) {
      const knop = await screen.findByRole("button", { name: n.label });
      expect(knop).toHaveAttribute("title", n.label);
    }
  });

  it("markeert welk tabblad open staat", async () => {
    vi.spyOn(api, "loadAll").mockResolvedValue({
      schema: { days: [], cardioDays: [], profile: {} },
      workoutLogs: [], cardioLogs: [], weightLogs: [], events: [], coachHistory: [],
    });
    vi.spyOn(api, "getPlannedSessions").mockResolvedValue({ plans: [] });
    vi.spyOn(api, "getBackups").mockResolvedValue({ backups: [], laatste: null });
    vi.spyOn(api, "getGoals").mockResolvedValue({});
    vi.spyOn(api, "getAutomation").mockResolvedValue({});

    vi.spyOn(api, "getPlannedRange").mockResolvedValue({ plans: [], krachttrainingen: [], evenementen: [] });
    vi.spyOn(api, "getWellnessLogs").mockResolvedValue([]);

    render(<App />);
    // De app opent op Vandaag, niet meer op Schema.
    expect(await screen.findByRole("button", { name: "Vandaag" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Instellingen" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Instellingen" }));
    expect(screen.getByRole("button", { name: "Instellingen" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("tab", { name: "Schema en profiel" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Doorklikken vanaf Vandaag", () => {
  const morgen = new Date(Date.now() + 864e5 * 10).toISOString().slice(0, 10);
  beforeEach(() => {
    vi.spyOn(api, "loadAll").mockResolvedValue({
      schema: { days: [], cardioDays: [], profile: {} },
      workoutLogs: [], cardioLogs: [], weightLogs: [],
      events: [{ id: "e1", name: "Veluwerit", date: morgen, type: "fietstocht" }],
      coachHistory: [],
    });
    vi.spyOn(api, "getPlannedSessions").mockResolvedValue({ plans: [] });
    vi.spyOn(api, "getPlannedRange").mockResolvedValue({ plans: [], krachttrainingen: [], evenementen: [] });
    vi.spyOn(api, "getWellnessLogs").mockResolvedValue([]);
    vi.spyOn(api, "getBackups").mockResolvedValue({ backups: [], laatste: null });
    vi.spyOn(api, "getGoals").mockResolvedValue({});
    vi.spyOn(api, "getAutomation").mockResolvedValue({});
  });

  it("opent bij het evenement meteen de evenementen", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Veluwerit/ }));
    expect(screen.getByRole("button", { name: "Instellingen" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("tab", { name: "Evenementen" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Hersteltabel", () => {
  const dag = (d, extra = {}) => ({
    date: d, restingHr: 48, sleepingHr: 52, hrvMs: 44, sleepMinutes: 420,
    sleepScore: 80, deepSleepMin: 90, remSleepMin: 70, respirationAvg: 12.3,
    source: "garmin", ...extra,
  });

  it("rondt de ademhaling af in plaats van de binaire ruis te tonen", async () => {
    // Garmin levert 12.3 als 12.299999999999999; die staart is geen meting.
    vi.spyOn(api, "getWellnessLogs").mockResolvedValue([
      dag("2026-10-20", { respirationAvg: 12.299999999999999 }),
    ]);
    render(<WellnessTab />);

    expect(await screen.findByText("12.3")).toBeInTheDocument();
    expect(screen.queryByText(/12\.2999/)).not.toBeInTheDocument();
  });

  it("toont standaard een week en de rest pas op verzoek", async () => {
    const dagen = Array.from({ length: 34 }, (_, i) =>
      dag(`2026-09-${String(i + 1).padStart(2, "0")}`)
    );
    vi.spyOn(api, "getWellnessLogs").mockResolvedValue(dagen);
    render(<WellnessTab />);

    const knop = await screen.findByRole("button", { name: "Toon alle 34 dagen" });
    // Honderdtwintig regels openklappen duwt alles eronder van het scherm af.
    expect(document.querySelectorAll("tbody tr")).toHaveLength(7);

    fireEvent.click(knop);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(34);
    expect(screen.getByRole("button", { name: "Toon alleen de laatste 7 dagen" })).toBeInTheDocument();
  });
});

describe("Rustdagen in de planner", () => {
  // De planner toont veertien dagen vanaf vandaag, dus de testdata loopt mee
  // met de klok in plaats van met vaste datums.
  const overDagen = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const rit = (n) => ({
    id: `p${n}`, date: overDagen(n), type: "Fietsen", description: "2u duurrit",
    status: "gepland", discipline: "cardio", locked: false,
  });

  function mockPlanning(plans) {
    vi.spyOn(api, "getPlannedRange").mockResolvedValue({
      plans, krachttrainingen: [], evenementen: [],
      samenvatting: { opvolgingPercentage: null },
      volgendEvenement: null,
    });
  }

  it("vat een reeks lege dagen samen tot één regel", async () => {
    // Twee ritten in veertien dagen levert anders twaalf "rustdag"-regels.
    mockPlanning([rit(0), rit(7)]);
    render(<PlannerTab onOpenSession={() => {}} />);

    const samenvattingen = await screen.findAllByTitle("Toon de losse rustdagen");
    expect(samenvattingen).toHaveLength(2);
    expect(samenvattingen[0]).toHaveTextContent("6 rustdagen");
    expect(screen.queryByText("rustdag")).not.toBeInTheDocument();

    fireEvent.click(samenvattingen[0]);
    expect(screen.getAllByText("rustdag")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Rustdagen weer samenvatten" })).toBeInTheDocument();
  });

  it("laat een losse rustdag gewoon staan", async () => {
    // Eén dag ertussen hoort bij het ritme van de week; die samenvatten
    // verbergt meer dan het oplevert.
    mockPlanning([...Array(14).keys()].filter((n) => n !== 1).map(rit));
    render(<PlannerTab onOpenSession={() => {}} />);

    expect(await screen.findByText("rustdag")).toBeInTheDocument();
    expect(screen.queryByTitle("Toon de losse rustdagen")).not.toBeInTheDocument();
  });
});

describe("Handmatig een cardiosessie invoeren", () => {
  const props = {
    addCardioLog: vi.fn(), addCardioLogsBulk: vi.fn(),
    weightLogs: [], onStravaImported: vi.fn(),
  };

  beforeEach(() => {
    vi.spyOn(api, "getStravaStatus").mockResolvedValue({ configured: false, connected: false });
    localStorage.clear();
  });

  it("staat klaar zolang er nog niets vanzelf binnenkomt", async () => {
    render(<CardioTab {...props} cardioLogs={[]} />);
    expect(await screen.findByText("Cardiosessie opslaan")).toBeInTheDocument();
  });

  const dagenGeleden = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  it("blijft dicht zodra Strava de ritten aanlevert", async () => {
    render(<CardioTab {...props} cardioLogs={[{ id: "a", date: dagenGeleden(2), source: "strava_sync" }]} />);
    expect(await screen.findByText(/Strava vult dit zelf/)).toBeInTheDocument();
    expect(screen.queryByText("Cardiosessie opslaan")).not.toBeInTheDocument();
  });

  it("staat weer klaar als er al een maand niets meer is binnengekomen", async () => {
    // Een verlopen token laat de koppeling staan maar levert niets meer op;
    // dan is dit formulier weer de manier waarop je een rit kwijt kunt.
    render(<CardioTab {...props} cardioLogs={[{ id: "a", date: dagenGeleden(60), source: "strava_sync" }]} />);
    expect(await screen.findByText("Cardiosessie opslaan")).toBeInTheDocument();
  });
});

describe("Herstelsignaal", () => {
  const reeks = (n, extra = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      sleepingHr: 48 + (i % 3), hrvMs: 60 + (i % 4), sleepMinutes: 450, ...extra(i, n),
    }));

  it("ziet een forse uitschieter in één nacht", () => {
    const o = herstelOverzicht(reeks(25, (i, n) => (i === n - 1 ? { sleepingHr: 60, hrvMs: 45 } : {})));
    expect(o.signalen.map((t) => t.id).sort()).toEqual(["hartslag", "hrv"]);
    expect(o.tegels.find((t) => t.id === "hartslag").label).toBe("Nachthartslag");
  });

  it("blijft rustig bij een normale nacht", () => {
    expect(herstelOverzicht(reeks(25)).signalen).toHaveLength(0);
  });
});

describe("Afvinken in de planner", () => {
  it("vinkt af met één knop en zet de rest achter het menu", async () => {
    const vandaag = new Date().toISOString().slice(0, 10);
    vi.spyOn(api, "getPlannedRange").mockResolvedValue({
      plans: [{ id: "p1", date: vandaag, type: "Fietsen", description: "duurrit", status: "gepland", discipline: "cardio", locked: false }],
      krachttrainingen: [], evenementen: [], volgendEvenement: null,
      samenvatting: { opvolgingPercentage: null },
    });
    const update = vi.spyOn(api, "updatePlannedSession").mockResolvedValue({});
    render(<PlannerTab onOpenSession={vi.fn()} />);

    await screen.findByRole("button", { name: "Fietsen op gedaan zetten" });
    expect(screen.queryByRole("menuitem", { name: /Overslaan/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Meer acties voor Fietsen" }));
    expect(screen.getByRole("menuitem", { name: /Overslaan/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fietsen op gedaan zetten" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("p1", "gedaan"));
  });
});
