import { useState, useEffect } from "react";
import { Timer, Play, RotateCcw, X } from "lucide-react";

const PRESETS = [60, 90, 120, 180];
const STORAGE_KEY = "tc-rust-timer";      // loopt door als je even naar een ander tabblad gaat
const DURATION_KEY = "tc-rust-duur";      // je vaste rusttijd, onthouden tussen sessies

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* private mode: dan telt de timer alleen in dit scherm door */
  }
}

/** Korte piep zonder geluidsbestand. Mag van de browser: je start hem zelf. */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (startAt, frequency) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + 0.18);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + 0.2);
    };
    play(0, 880);
    play(0.25, 1175);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* geen audio beschikbaar — de kleurverandering blijft */
  }
}

/**
 * Eén timer voor het hele scherm, buiten React om.
 *
 * De timer verschijnt op twee plekken tegelijk: groot boven de oefeningen en
 * als knopje bij elke set. Zouden dat losse componenten met eigen state zijn,
 * dan start het knopje bij set 3 een andere timer dan die je bovenaan ziet
 * aftellen — en dat is precies het soort ding waar je in de sportschool niet
 * achter wilt komen. Het aftellen loopt op een eindtijdstip in localStorage,
 * zodat wegklikken of het scherm laten dimmen de rust niet reset.
 */
const listeners = new Set();
let alarm = null;

const initialStored = Number(readStored(STORAGE_KEY));
let state = {
  duration: Number(readStored(DURATION_KEY)) || 90,
  // Een timer die tijdens het wegklikken allang afgelopen is hoeft niet
  // alsnog te piepen bij terugkomst.
  endsAt: initialStored && initialStored > Date.now() ? initialStored : null,
};

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function startTimer(seconds) {
  const end = Date.now() + seconds * 1000;
  clearTimeout(alarm);
  // Het alarm hangt aan de timer zelf, niet aan een gemonteerd component: ga je
  // tussendoor naar een ander tabblad, dan piept hij nog steeds.
  alarm = setTimeout(() => {
    beep();
    if (navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]); } catch { /* niet overal ondersteund */ }
    }
    writeStored(STORAGE_KEY, null);
    emit({});
  }, seconds * 1000);
  writeStored(STORAGE_KEY, end);
  emit({ endsAt: end });
}

function stopTimer() {
  clearTimeout(alarm);
  writeStored(STORAGE_KEY, null);
  emit({ endsAt: null });
}

function setDuration(seconds) {
  writeStored(DURATION_KEY, seconds);
  emit({ duration: seconds });
}

/** Abonneert dit component op de gedeelde timer en tikt mee zolang hij loopt. */
function useRestTimer() {
  const [, force] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (!state.endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.endsAt]);

  const remaining = state.endsAt ? (state.endsAt - now) / 1000 : null;
  return {
    duration: state.duration,
    running: !!state.endsAt && remaining > 0,
    // Blijft "klaar" tot je opnieuw start, zodat je het ziet als je net keek.
    done: !!state.endsAt && remaining !== null && remaining <= 0,
    remaining,
  };
}

function formatSeconds(total) {
  const s = Math.max(0, Math.ceil(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function RestTimer({ compact = false }) {
  const { duration, running, done, remaining } = useRestTimer();

  if (compact) {
    return (
      <button
        className={"tc-btn tc-btn-ghost tc-btn-sm" + (running ? " tc-resttimer-active" : "")}
        onClick={() => startTimer(duration)}
        title={`Rust van ${duration} seconden starten`}
      >
        <Timer size={13} /> {running ? formatSeconds(remaining) : `${duration}s`}
      </button>
    );
  }

  return (
    <div className={"tc-card tc-resttimer" + (done ? " tc-resttimer-done" : "")}>
      <div className="tc-resttimer-main">
        <Timer size={16} className={running ? "tc-resttimer-running" : ""} />
        <span className="tc-resttimer-value tc-mono">
          {running || done ? formatSeconds(remaining) : formatSeconds(duration)}
        </span>
        {done && <span className="tc-hint-badge tc-badge-strength">rust voorbij</span>}

        {running ? (
          <>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => startTimer(duration)}>
              <RotateCcw size={13} /> Opnieuw
            </button>
            <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={stopTimer}>
              <X size={13} /> Stop
            </button>
          </>
        ) : (
          <button className="tc-btn tc-btn-strength tc-btn-sm" onClick={() => startTimer(duration)}>
            <Play size={13} /> Start rust
          </button>
        )}
      </div>

      <div className="tc-weekday-toggles" style={{ marginBottom: 0, marginTop: 8 }}>
        {PRESETS.map((p) => (
          <button key={p} type="button"
            className={"tc-weekday-toggle" + (duration === p ? " active" : "")}
            onClick={() => {
              setDuration(p);
              if (running) startTimer(p); // loopt hij al, dan meteen bijstellen
            }}>
            {p < 60 ? `${p}s` : `${p / 60} min`}
          </button>
        ))}
      </div>
    </div>
  );
}
