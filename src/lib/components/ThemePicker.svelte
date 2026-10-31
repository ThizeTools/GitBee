<script lang="ts">
  import {
    BUILTIN_THEMES, VAR_MAP, type Theme, type ThemeVars,
    activeThemeId, customThemes, themePickerOpen,
    resolveTheme, applyTheme, saveCustomTheme, deleteCustomTheme,
  } from "$lib/stores/ui";
  import { alertDialog, confirmDialog } from "$lib/stores/dialog";
  import Icon from "$lib/icons/Icon.svelte";

  // Editor state — null means "no editor open, just showing the grid".
  let editor = $state<Theme | null>(null);
  let snapshotBefore: Theme | null = $state(null);

  function close() {
    // If the user was editing without saving, restore the previously active
    // theme so live-preview tweaks don't leak after dismissing the modal.
    if (editor && snapshotBefore) {
      applyTheme(resolveTheme($activeThemeId, $customThemes));
    }
    editor = null;
    snapshotBefore = null;
    themePickerOpen.set(false);
  }

  function pick(t: Theme) {
    activeThemeId.set(t.id);
  }

  function startCustom(base: Theme) {
    snapshotBefore = resolveTheme($activeThemeId, $customThemes);
    const id = `custom-${Date.now().toString(36)}`;
    editor = {
      id, name: `My ${base.name}`, builtin: false,
      vars: { ...base.vars },
    };
    applyTheme(editor);
  }

  function startEdit(t: Theme) {
    snapshotBefore = resolveTheme($activeThemeId, $customThemes);
    // Built-ins are immutable — double-clicking one starts a NEW custom
    // theme initialized from its colors. Only existing customs get edited
    // in place. Without this fork, saving an edited built-in would push a
    // custom into the list with the same id as the built-in, producing
    // duplicate keys in the grid {#each} and bricking the picker.
    if (t.builtin) {
      const id = `custom-${Date.now().toString(36)}`;
      editor = { id, name: `My ${t.name}`, builtin: false, vars: { ...t.vars } };
    } else {
      editor = { ...t, vars: { ...t.vars } };
    }
    applyTheme(editor);
  }

  function onColor(key: keyof ThemeVars, value: string) {
    if (!editor) return;
    editor = { ...editor, vars: { ...editor.vars, [key]: value } };
    applyTheme(editor);
  }

  function onScheme(scheme: "dark" | "light") {
    if (!editor) return;
    editor = { ...editor, vars: { ...editor.vars, scheme } };
    applyTheme(editor);
  }

  function persist() {
    if (!editor) return;
    // Deep-clone the editor before handing it off — `editor` is `$state`-
    // tracked, so it's a Svelte 5 reactive proxy. Storing the raw proxy in
    // customThemes leaks the reactivity into the persisted list and breaks
    // subsequent renders / JSON.stringify calls. A plain-JSON snapshot
    // sidesteps that entirely.
    const snapshot: Theme = {
      id: editor.id,
      name: editor.name,
      builtin: editor.builtin,
      vars: { ...editor.vars },
    };
    saveCustomTheme(snapshot);
    activeThemeId.set(snapshot.id);
    editor = null;
    snapshotBefore = null;
  }

  function cancel() {
    if (snapshotBefore) applyTheme(resolveTheme($activeThemeId, $customThemes));
    editor = null;
    snapshotBefore = null;
  }

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: "Delete this custom theme?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    deleteCustomTheme(id);
  }

  // ---- Export / Import ----
  // Single-theme export downloads a `.gkptheme.json` file. Multi-import
  // accepts either one theme object or an array; built-in ids are remapped
  // to fresh `custom-*` ids so re-importing never collides with the
  // built-ins shipped with the app.
  async function exportTheme(t: Theme) {
    const payload = { kind: "gkp.theme", version: 1, theme: t };
    const json = JSON.stringify(payload, null, 2);
    const fname = `${t.name.replace(/[^\w-]+/g, "_")}.gkptheme.json`;

    // Prefer the File System Access API — it shows a real OS save dialog
    // letting the user pick the destination folder. Available in Chromium /
    // WebView2 (which Tauri uses on Windows). Fall back to an anchor
    // download if the API is unavailable or the user's webview blocks it.
    type WithSavePicker = Window & {
      showSaveFilePicker?: (opts?: unknown) => Promise<{
        createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
      }>;
    };
    const w = window as WithSavePicker;
    if (typeof w.showSaveFilePicker === "function") {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: fname,
          types: [{
            description: "GitBee theme",
            accept: { "application/json": [".json", ".gkptheme.json"] },
          }],
        });
        const stream = await handle.createWritable();
        await stream.write(json);
        await stream.close();
        return;
      } catch (e) {
        // User-cancel raises AbortError — silently bail; anything else,
        // fall through to the legacy download path below.
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-importing the same file later
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const incoming: unknown = Array.isArray(parsed) ? parsed
        : parsed?.themes ?? parsed?.theme ?? parsed;
      const list = Array.isArray(incoming) ? incoming : [incoming];
      let imported = 0;
      for (const item of list) {
        if (!isTheme(item)) continue;
        const fresh: Theme = {
          ...item,
          // Re-key as a custom theme so it never overwrites a built-in.
          id: `custom-${Date.now().toString(36)}-${imported}`,
          builtin: false,
        };
        saveCustomTheme(fresh);
        imported++;
      }
      if (imported === 0) await alertDialog({ title: "No valid themes in that file." });
      else if (imported === 1) await alertDialog({ title: "Theme imported." });
      else await alertDialog({ title: `${imported} themes imported.` });
    } catch (err) {
      await alertDialog({ title: `Import failed: ${err}` });
    }
  }

  function isTheme(v: unknown): v is Theme {
    if (!v || typeof v !== "object") return false;
    const t = v as Record<string, unknown>;
    if (typeof t.name !== "string") return false;
    const vars = t.vars as Record<string, unknown> | undefined;
    if (!vars || typeof vars !== "object") return false;
    return VAR_MAP.every(({ key }) => typeof vars[key] === "string");
  }

  let importInput: HTMLInputElement | null = $state(null);

  // Combined list for the grid.
  const allThemes = $derived<Theme[]>([...BUILTIN_THEMES, ...$customThemes]);
</script>

{#if $themePickerOpen}
  <div class="backdrop" onclick={close} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog"
      tabindex="-1" onkeydown={(e) => { if (e.key === "Escape") close(); }}>
      <header class="head">
        <h2>{editor ? "Custom theme" : "Theme"}</h2>
        {#if !editor}
          <button class="head-btn" onclick={() => importInput?.click()} title="Import .gkptheme.json">
            <Icon name="download" size={14} /> Import
          </button>
          <input type="file" accept=".json,application/json" bind:this={importInput}
            style:display="none" onchange={onImport} />
        {/if}
        <button class="x" onclick={close} title="Close" aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>

      {#if !editor}
        <div class="grid">
          {#each allThemes as t (t.id)}
            <div class="card" class:active={t.id === $activeThemeId}
              role="button" tabindex="0"
              onclick={() => pick(t)}
              onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") pick(t); }}
              ondblclick={() => startEdit(t)}>
              <div class="swatch" style:background={t.vars.bg}>
                <div class="swatch-row">
                  <span style:background={t.vars.bgElev}></span>
                  <span style:background={t.vars.sidebarBg}></span>
                  <span style:background={t.vars.rightpanelBg}></span>
                </div>
                <div class="swatch-row">
                  <span style:background={t.vars.fg}></span>
                  <span style:background={t.vars.fgMuted}></span>
                  <span style:background={t.vars.accent}></span>
                </div>
              </div>
              <div class="card-foot">
                <span class="name">{t.name}</span>
                <span class="actions">
                  <button type="button" class="ico-btn" title="Export" aria-label="Export"
                    onclick={(e) => { e.stopPropagation(); exportTheme(t); }}>
                    <Icon name="export" size={14} />
                  </button>
                  {#if !t.builtin}
                    <button type="button" class="ico-btn" title="Edit" aria-label="Edit"
                      onclick={(e) => { e.stopPropagation(); startEdit(t); }}>
                      <Icon name="file-modified" size={14} />
                    </button>
                    <button type="button" class="ico-btn danger" title="Delete" aria-label="Delete"
                      onclick={(e) => { e.stopPropagation(); remove(t.id); }}>
                      <Icon name="trash" size={14} />
                    </button>
                  {/if}
                </span>
                {#if t.id === $activeThemeId}
                  <span class="dot">
                    <Icon name="check" size={12} title="Active theme" />
                  </span>
                {/if}
              </div>
            </div>
          {/each}
          <button class="card add" onclick={() => startCustom(BUILTIN_THEMES[0])}>
            <div class="add-ico"><Icon name="add" size={24} /></div>
            <div class="card-foot"><span class="name">New custom theme</span></div>
          </button>
        </div>
        <p class="hint">Single-click selects · double-click a card to edit a copy.</p>
      {:else}
        <div class="editor">
          <label class="row">
            <span class="lbl">Name</span>
            <input type="text" bind:value={editor.name} />
          </label>
          <label class="row">
            <span class="lbl">Color scheme</span>
            <span class="seg">
              <button class:active={editor.vars.scheme === "dark"}
                onclick={() => onScheme("dark")}>Dark</button>
              <button class:active={editor.vars.scheme === "light"}
                onclick={() => onScheme("light")}>Light</button>
            </span>
          </label>
          {#each VAR_MAP as v (v.key)}
            <label class="row color-row">
              <span class="lbl">{v.label}</span>
              <input type="color" value={editor.vars[v.key]}
                oninput={(e) => onColor(v.key, (e.currentTarget as HTMLInputElement).value)} />
              <input type="text" value={editor.vars[v.key]} class="hex"
                oninput={(e) => onColor(v.key, (e.currentTarget as HTMLInputElement).value)} />
            </label>
          {/each}
          <footer class="foot">
            <button onclick={() => exportTheme(editor!)}>
              <Icon name="export" size={14} /> Export
            </button>
            <span style:flex="1"></span>
            <button onclick={cancel}>Cancel</button>
            <button class="primary" onclick={persist}>Save & apply</button>
          </footer>
          <p class="hint">Changes preview live. Save to keep across restarts.</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000;
  }
  .modal {
    width: min(720px, 92vw);
    max-height: 86vh;
    display: flex; flex-direction: column;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0,0,0,0.55);
    overflow: hidden;
    color: var(--fg);
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .head {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
  }
  .head h2 { margin: 0; flex: 1; font-size: var(--fs-lg); font-weight: 600; }
  .head-btn {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    height: 28px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-5); cursor: pointer; font-size: var(--fs-md);
  }
  .head-btn:hover { background: var(--border); }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--sp-6);
    padding: var(--sp-15) var(--sp-20);
    overflow: auto;
  }
  .card {
    display: flex; flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0;
    cursor: pointer;
    color: var(--fg);
    text-align: left;
    overflow: hidden;
  }
  .card:hover { border-color: var(--border-strong); }
  .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .swatch {
    height: 80px; padding: var(--sp-4);
    display: flex; flex-direction: column; gap: var(--sp-3); justify-content: center;
  }
  .swatch-row { display: flex; gap: var(--sp-3); }
  .swatch-row span {
    flex: 1; height: 18px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .card-foot {
    display: flex; align-items: center; gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: var(--fs-md);
  }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: var(--sp-2); }
  .ico-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row);
    background: transparent; border: 0;
    color: var(--fg-muted); border-radius: var(--radius);
    cursor: pointer;
  }
  .ico-btn:hover { background: var(--border); color: var(--fg); }
  .ico-btn.danger:hover { color: var(--del); }
  .dot {
    display: inline-flex; align-items: center; color: var(--accent);
  }

  .card.add {
    align-items: center; justify-content: center;
    border-style: dashed;
  }
  .add-ico {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--fg-muted);
  }
  .card.add:hover .add-ico { color: var(--accent); }

  .editor {
    padding: var(--sp-15) var(--sp-20);
    overflow: auto;
    display: flex; flex-direction: column; gap: var(--sp-5);
  }
  .row {
    display: grid;
    grid-template-columns: 140px 50px 1fr;
    align-items: center; gap: var(--sp-5);
  }
  .row:not(.color-row) { grid-template-columns: 140px 1fr; }
  .lbl { color: var(--fg-muted); font-size: var(--fs-md); }
  .row input[type="text"] {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-4); font: inherit;
  }
  .row input[type="color"] {
    width: 50px; height: 28px; padding: 0;
    border: 1px solid var(--border); border-radius: var(--radius); background: transparent;
    cursor: pointer;
  }
  .hex { font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-md); }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .seg button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: var(--sp-3) var(--sp-8); cursor: pointer; font-size: var(--fs-md);
  }
  .seg button.active { background: var(--accent); color: var(--bg); font-weight: 600; }

  .foot {
    display: flex; gap: var(--sp-4); justify-content: flex-end; align-items: center;
    padding-top: var(--sp-4); border-top: 1px solid var(--border);
    margin-top: var(--sp-3);
  }
  /* Footer buttons: 28 px high. */
  .foot button {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    height: 28px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-6); cursor: pointer; font-size: var(--fs-md);
  }
  .foot button:hover { background: var(--border); }
  .foot button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }

  .hint {
    margin: 0; padding: 0 var(--sp-20) var(--sp-6);
    font-size: var(--fs-sm); color: var(--fg-muted);
  }
</style>
