// ── [FIX-1 | S01 | v0.1.0] Create the sample module ──
// ── [FIX-2 | S01 | v0.1.0] Add the greeting function ──
//    Fixture file for the Orqiva tests: two tasks shaped this file.

// ── [FIX-1 | S01 | v0.1.0] the module constant ──
export const NAME = 'fixture';

// ── [FIX-2 | S01 | v0.1.0] greet: says hello to a name ──
export function greet(name: string): string {
  return `Hello ${name}`;
}
