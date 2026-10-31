// highlight.js ships no type declarations for its per-language modules. Each
// one default-exports a LanguageFn, so they all get that typed shape here.
// Keep this file free of top-level import/export: it must stay an ambient
// declaration for the wildcard module name to apply.
declare module "highlight.js/lib/languages/*" {
  const language: import("highlight.js").LanguageFn;
  export default language;
}
