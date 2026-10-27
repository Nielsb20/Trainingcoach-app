import { Dumbbell, Activity, MessageCircle, Settings, Sunrise, Sun, Moon, CalendarDays, Home, Plus, TrendingUp } from "lucide-react";

// Negen tabbladen naast elkaar waren er te veel: op een telefoon twee rijen
// pictogrammen bovenaan, en wat je dagelijks doet (loggen, kijken wat er
// vandaag staat) stond tussen wat je eens per maand aanraakt (schema,
// evenementen, koppelingen). Nu vijf onderdelen voor elke dag, en de rest
// onder Instellingen.
//
//   Vandaag     — nieuw: herstel, training van vandaag, laatste coachadvies
//   Planning    — ongewijzigd
//   Loggen      — kracht (meestal) en cardio
//   Voortgang   — was Geschiedenis, met Gewicht en Herstel erbij
//   Coach       — met het schemavoorstel, dat eerst onder Schema zat
//   Instellingen — Schema en Evenementen
export const NAV = [
  { id: "vandaag", label: "Vandaag", icon: Home },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "loggen", label: "Loggen", icon: Plus, primary: true },
  { id: "voortgang", label: "Voortgang", icon: TrendingUp },
  { id: "coach", label: "Coach", icon: MessageCircle },
];

export const SETTINGS_NAV = { id: "instellingen", label: "Instellingen", icon: Settings };

// Wat er onder Loggen valt. Gewicht en herstel komen meestal vanzelf binnen
// (weegschaal, horloge) en staan daarom bij Voortgang, met het handmatige
// formulier onderaan.
export const LOG_KINDS = [
  { id: "kracht", label: "Kracht", icon: Dumbbell },
  { id: "cardio", label: "Cardio", icon: Activity },
];

export const TIME_OF_DAY = [
  { id: "ochtend", label: "Ochtend", icon: Sunrise },
  { id: "middag", label: "Middag", icon: Sun },
  { id: "avond", label: "Avond", icon: Moon },
];

export const CARDIO_TYPES = ["Hardlopen", "Fietsen", "Zwemmen", "Wandelen", "Anders"];

// NOTE: WEEKDAYS lives in lib/calculations.js (the shared core), not here,
// so the weekday logic stays in one place alongside weekdayNameForDate().

export const EVENT_TYPES = [
  "Hardloopwedstrijd",
  "Wielerevenement",
  "Triatlon",
  "Zwemwedstrijd",
  "Krachttoernooi/meet",
  "Anders",
];

export const DUTCH_MONTHS = {
  jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};
