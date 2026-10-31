<script lang="ts">
  // "Sign" toggle beside Amend. The parent resolves the value (repo default
  // plus the user's saved choice); this only reports a toggle. Signing itself
  // is git's job: a failure shows git's own stderr through the commit error.
  import OptionToggle from "./OptionToggle.svelte";

  interface Props {
    signed: boolean;
    onToggle: (value: boolean) => void;
  }
  let { signed, onToggle }: Props = $props();
</script>

<OptionToggle
  icon="lock"
  label="Sign"
  checked={signed}
  title="Sign this commit with the key git is set up to use (commit.gpgsign)"
  onChange={onToggle}
/>
