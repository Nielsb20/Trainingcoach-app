import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* jsdom zonder opslag: dan valt er ook niets op te ruimen */
  }
});

// Recharts meet zijn container op; in jsdom is die nul bij nul, waardoor de
// grafieken niets tekenen en waarschuwingen spuien. Een vaste maat maakt de
// tests stil en voorspelbaar.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
