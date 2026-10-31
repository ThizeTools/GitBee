// Syntax highlighting for diff lines, behind a project-owned interface so the
// rest of the app never imports highlight.js directly. Only the grammars
// below are registered: importing the full bundle would pull in every grammar
// for a viewer that needs about two dozen.
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { basenameOf, extensionOf } from "./paths";

const LANGUAGES: ReadonlyArray<readonly [string, LanguageFn]> = [
  ["bash", bash], ["c", c], ["cpp", cpp], ["csharp", csharp], ["css", css],
  ["dockerfile", dockerfile], ["go", go], ["ini", ini], ["java", java],
  ["javascript", javascript], ["json", json], ["kotlin", kotlin],
  ["markdown", markdown], ["php", php], ["powershell", powershell],
  ["python", python], ["ruby", ruby], ["rust", rust], ["scss", scss],
  ["sql", sql], ["swift", swift], ["typescript", typescript], ["xml", xml],
  ["yaml", yaml],
];
for (const [name, grammar] of LANGUAGES) hljs.registerLanguage(name, grammar);

// toml maps to `ini`: highlight.js has no TOML grammar, and ini covers the
// `[section]` and `key = value` forms that config files use.
// svelte and vue are not registered as their own grammars; their markup is
// highlighted as XML, which covers the tags, attributes and strings.
const EXTENSION_LANGUAGE: ReadonlyMap<string, string> = new Map<string, string>([
  ["ts", "typescript"], ["tsx", "typescript"],
  ["js", "javascript"], ["jsx", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"],
  ["rs", "rust"], ["py", "python"], ["go", "go"], ["java", "java"], ["kt", "kotlin"],
  ["c", "c"], ["h", "c"], ["cpp", "cpp"], ["hpp", "cpp"], ["cs", "csharp"],
  ["json", "json"], ["yaml", "yaml"], ["yml", "yaml"], ["toml", "ini"],
  ["md", "markdown"], ["html", "xml"], ["svelte", "xml"], ["vue", "xml"], ["xml", "xml"],
  ["css", "css"], ["scss", "scss"], ["sh", "bash"], ["bash", "bash"], ["ps1", "powershell"],
  ["sql", "sql"], ["rb", "ruby"], ["php", "php"], ["swift", "swift"],
]);

/** Highlight.js language name for a file path, or null when unknown. */
export function langForPath(path: string): string | null {
  if (basenameOf(path).toLowerCase() === "dockerfile") return "dockerfile";
  return EXTENSION_LANGUAGE.get(extensionOf(path)) ?? null;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

/** Escapes text for use as HTML content. File text must pass through here or
 *  through highlight.js, which also escapes; nothing else may reach {@html}. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch: string) => HTML_ESCAPES[ch]);
}

/**
 * Safe HTML for one line of code. Unknown or missing languages render as
 * escaped plain text. Callers highlight one line at a time: multi-line
 * constructs (block comments, template strings) can color imperfectly.
 * Usage: highlightCode("const a = 1", "typescript").
 */
export function highlightCode(code: string, lang: string | null): string {
  if (lang === null || !hljs.getLanguage(lang)) return escapeHtml(code);
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
