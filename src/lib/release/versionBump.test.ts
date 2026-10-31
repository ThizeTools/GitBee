import { describe, expect, test } from "bun:test";
import { nextVersion, setCargoLockVersion, setCargoTomlVersion } from "./versionBump";

describe("nextVersion", () => {
  test("patch, minor and major bumps", () => {
    expect(nextVersion("0.4.0", "patch")).toBe("0.4.1");
    expect(nextVersion("0.4.7", "minor")).toBe("0.5.0");
    expect(nextVersion("0.4.7", "major")).toBe("1.0.0");
  });

  test("an explicit x.y.z wins", () => {
    expect(nextVersion("0.4.0", "2.0.3")).toBe("2.0.3");
  });

  test("an unknown bump throws with the value", () => {
    expect(() => nextVersion("0.4.0", "huge")).toThrow('"huge"');
  });
});

describe("setCargoTomlVersion", () => {
  test("replaces only the [package] version, not dependency versions", () => {
    const toml = '[package]\nname = "gitbee"\nversion = "0.4.0"\n\n[dependencies]\ntauri = { version = "2" }\n';
    const out = setCargoTomlVersion(toml, "0.4.1");
    expect(out).toContain('version = "0.4.1"');
    expect(out).toContain('tauri = { version = "2" }');
  });

  test("throws when there is no version line", () => {
    expect(() => setCargoTomlVersion("[package]\n", "0.4.1")).toThrow("version");
  });
});

describe("setCargoLockVersion", () => {
  test("sets the named package and leaves others alone", () => {
    const lock = '[[package]]\nname = "gitbee"\nversion = "0.4.0"\n\n[[package]]\nname = "tauri"\nversion = "2.1.0"\n';
    const out = setCargoLockVersion(lock, "gitbee", "0.4.1");
    expect(out).toContain('name = "gitbee"\nversion = "0.4.1"');
    expect(out).toContain('name = "tauri"\nversion = "2.1.0"');
  });

  test("throws naming the missing package", () => {
    expect(() => setCargoLockVersion("", "gitbee", "0.4.1")).toThrow('"gitbee"');
  });
});
