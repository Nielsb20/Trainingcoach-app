import { Dumbbell, Activity, MessageCircle, History, Settings, Flag, Scale, Sunrise, Sun, Moon, PieChart, HeartPulse, CalendarDays } from "lucide-react";

export const NAV = [
  { id: "schema", label: "Schema", icon: Settings },
  { id: "kracht", label: "Kracht loggen", icon: Dumbbell },
  { id: "cardio", label: "Cardio loggen", icon: Activity },
  { id: "gewicht", label: "Gewicht", icon: Scale },
  { id: "herstel", label: "Herstel", icon: HeartPulse },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "evenementen", label: "Evenementen", icon: Flag },
  { id: "geschiedenis", label: "Geschiedenis", icon: History },
  { id: "analyse", label: "Analyse", icon: PieChart },
  { id: "coach", label: "Coach", icon: MessageCircle },
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
