import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ErrorBoundary from "../components/shared/ErrorBoundary";
import CollapsibleCard from "../components/shared/CollapsibleCard";
import RestTimer from "../components/shared/RestTimer";
import KrachtTab from "../components/KrachtTab";
import EventsTab from "../components/EventsTab";
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
