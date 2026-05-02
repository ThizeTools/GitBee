// Single source of truth = package.json. Vite resolves the JSON import
// at build time, so this stays a constant in the bundle.
import pkg from "../../package.json";
export const appVersion: string = pkg.version;
