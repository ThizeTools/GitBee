<script lang="ts">
  // "Sign" checkbox beside Amend. The parent resolves the value (repo default
  // plus the user's saved choice); this only reports a toggle. Signing itself
  // is git's job: a failure shows git's own stderr through the commit error.
  interface Props {
    signed: boolean;
    onToggle: (value: boolean) => void;
  }
  let { signed, onToggle }: Props = $props();
</script>

<label
  class="sign"
  title="Sign this commit with the key git is set up to use (commit.gpgsign)"
>
  <input
    type="checkbox"
    checked={signed}
    onchange={(e) => onToggle(e.currentTarget.checked)}
  />
  Sign
</label>

<style>
  .sign {
    font-size: 11px; color: var(--fg-muted);
    display: flex; gap: 6px; align-items: center;
  }
</style>
