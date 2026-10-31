import { describe, test, expect } from "bun:test";
import { escapeHtml, highlightCode, langForPath } from "./highlight";

describe("langForPath", () => {
  test("maps known extensions to highlight.js language names", () => {
    expect(langForPath("src/app.ts")).toBe("typescript");
    expect(langForPath("web/Page.svelte")).toBe("xml");
    expect(langForPath("config/app.yml")).toBe("yaml");
    expect(langForPath("conf/Cargo.TOML")).toBe("ini");
  });

  test("uses the last segment of Windows and POSIX paths", () => {
    expect(langForPath("C:\\repo\\src\\lib.RS")).toBe("rust");
    expect(langForPath("a/b/c.py")).toBe("python");
  });

  test("recognises Dockerfile by name", () => {
    expect(langForPath("deploy/Dockerfile")).toBe("dockerfile");
  });

  test("unknown or extensionless names give null", () => {
    expect(langForPath("notes.xyz")).toBeNull();
    expect(langForPath("LICENSE")).toBeNull();
    expect(langForPath("dir/.env")).toBeNull();
  });
});

describe("escapeHtml", () => {
  test("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("highlightCode", () => {
  test("null language renders escaped plain text", () => {
    expect(highlightCode('<a href="x">&', null)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  test("unregistered language falls back to escaped text", () => {
    expect(highlightCode("<b>", "not-a-language")).toBe("&lt;b&gt;");
  });

  test("registered language wraps keywords in hljs token classes", () => {
    const html = highlightCode("const a = 1", "typescript");
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  test("file text cannot inject markup through a highlighted line", () => {
    const html = highlightCode("<script>alert(1)</script>", "typescript");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script");
  });
});
