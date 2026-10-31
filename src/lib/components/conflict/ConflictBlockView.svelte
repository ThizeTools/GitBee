<script lang="ts">
  import type { ConflictBlock, ConflictChoice } from "$lib/conflict/parse";
  import { linesForChoice } from "$lib/conflict/parse";
  import { takeLabel, type SideNames } from "$lib/conflict/labels";

  // One conflict block: both sides stacked and highlighted, the take buttons,
  // and a textarea that appears once the result is hand-edited.
  interface Props {
    block: ConflictBlock;
    /** Position in the file, 0-based. Keys the choice and the DOM id. */
    index: number;
    total: number;
    names: SideNames;
    choice: ConflictChoice | undefined;
    active: boolean;
    onChoose: (choice: ConflictChoice) => void;
  }
  let { block, index, total, names, choice, active, onChoose }: Props = $props();

  const isCustom = $derived(typeof choice === "object");

  // WHY: "Edit result" seeds the textarea with what the block shows now, so
  // hand edits start from the current resolution instead of from scratch.
  function startEdit(): void {
    if (isCustom) return;
    onChoose({ custom: linesForChoice(block, choice ?? "ours").join("\n") });
  }

  function choiceName(c: ConflictChoice | undefined): string {
    if (c === undefined) return "";
    if (typeof c === "object") return "Custom result";
    const labels: Record<"ours" | "theirs" | "both" | "bothReverse", string> = {
      ours: takeLabel("ours", names),
      theirs: takeLabel("theirs", names),
      both: "Both",
      bothReverse: "Both (theirs first)",
    };
    return labels[c];
  }

  function showLines(lines: string[]): string {
    return lines.length === 0 ? "(no lines)" : lines.join("\n");
  }
</script>

<section id="conflict-block-{index}" class="block" class:active class:done={choice !== undefined}>
  <header class="bhead">
    <span class="title">Conflict {index + 1} of {total}</span>
    {#if choice !== undefined}
      <span class="chosen">{choiceName(choice)}</span>
    {:else}
      <span class="undecided">undecided</span>
    {/if}
  </header>

  <div class="side ours">
    <div class="sh">{names.ours}{block.oursLabel ? ` · ${block.oursLabel}` : ""}</div>
    <pre class:empty={block.ours.length === 0}>{showLines(block.ours)}</pre>
  </div>

  {#if block.base !== null}
    <details class="side base">
      <summary>Base (common ancestor)</summary>
      <pre>{showLines(block.base)}</pre>
    </details>
  {/if}

  <div class="side theirs">
    <div class="sh">{names.theirs}{block.theirsLabel ? ` · ${block.theirsLabel}` : ""}</div>
    <pre class:empty={block.theirs.length === 0}>{showLines(block.theirs)}</pre>
  </div>

  <div class="choose">
    <button class:picked={choice === "ours"} onclick={() => onChoose("ours")}>{takeLabel("ours", names)}</button>
    <button class:picked={choice === "theirs"} onclick={() => onChoose("theirs")}>{takeLabel("theirs", names)}</button>
    <button class:picked={choice === "both"} onclick={() => onChoose("both")}>Take both</button>
    <button class:picked={choice === "bothReverse"} onclick={() => onChoose("bothReverse")}>Take both (theirs first)</button>
    <button class="edit" class:picked={isCustom} onclick={startEdit}>Edit result</button>
  </div>

  {#if typeof choice === "object"}
    <label class="custom">
      <span class="sh">Edit result</span>
      <textarea
        rows={Math.min(14, Math.max(3, choice.custom.split("\n").length))}
        spellcheck="false"
        value={choice.custom}
        oninput={(e) => onChoose({ custom: e.currentTarget.value })}
      ></textarea>
    </label>
  {/if}
</section>

<style>
  .block {
    margin: var(--sp-5) var(--sp-8); border: 1px solid var(--border-strong); border-radius: var(--radius);
    background: var(--bg-elev); overflow: hidden;
  }
  .block.active { border-color: var(--accent); }
  /* Block header: 30 px, the section-header size in the layout spec. */
  .bhead {
    display: flex; align-items: center; gap: var(--sp-5); height: var(--h-section); padding: 0 var(--sp-5);
    border-bottom: 1px solid var(--border); font-size: var(--fs-sm);
  }
  .title { font-weight: 700; color: var(--fg); }
  .chosen { color: var(--add, var(--accent)); font-weight: 600; }
  .undecided { color: var(--del); font-weight: 600; }
  .side { border-top: 1px solid var(--border); }
  .side:first-of-type { border-top: 0; }
  .sh {
    font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.5px;
    padding: var(--sp-2) var(--sp-5); color: var(--fg-muted); font-weight: 700;
  }
  .side pre, details.side pre {
    margin: 0; padding: var(--sp-3) var(--sp-5); max-height: 260px; overflow: auto;
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-md); line-height: 18px;
    white-space: pre; color: var(--fg);
  }
  .side pre.empty { font-style: italic; color: var(--fg-muted); }
  .ours pre { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .theirs pre { background: color-mix(in srgb, var(--add, var(--accent)) 14%, transparent); }
  details.base summary {
    cursor: pointer; padding: var(--sp-2) var(--sp-5); font-size: var(--fs-xs); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
  }
  .choose {
    display: flex; flex-wrap: wrap; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border); background: var(--bg);
  }
  /* Choice buttons: 24 px high, the toolbar hit size. */
  .choose button {
    height: var(--h-row); background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border);
    padding: 0 var(--sp-5); border-radius: var(--radius); cursor: pointer; font-size: var(--fs-sm);
  }
  .choose button:hover { border-color: var(--accent); }
  .choose button.picked {
    background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent);
  }
  .custom { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
  .custom textarea {
    margin: 0 var(--sp-5) var(--sp-5); padding: var(--sp-3) var(--sp-4); resize: vertical; min-height: 60px;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius);
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-md);
  }
</style>
