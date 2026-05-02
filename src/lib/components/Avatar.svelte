<script lang="ts">
  // Resolves an email to a cached avatar PNG via the backend, displaying
  // colored initials while the file isn't there yet (or if the resolve
  // fails). One small in-memory map dedupes concurrent requests for the
  // same email — without it, scrolling the graph fires N copies of the
  // same fetch.
  import { ipc } from "$lib/ipc";
  import { convertFileSrc } from "@tauri-apps/api/core";

  interface Props {
    email: string | null | undefined;
    name?: string | null;
    size?: number; // px
  }
  let { email, name, size = 16 }: Props = $props();

  let src = $state<string | null>(null);
  let failed = $state(false);

  // Process-wide cache so re-rendering rows doesn't re-hit the backend.
  // Value is a Promise so concurrent mounts coalesce into one IPC call.
  type Pending = Promise<string>;
  const cache: Map<string, Pending> = ((): Map<string, Pending> => {
    const w = window as unknown as { __ghAvatarCache?: Map<string, Pending> };
    if (!w.__ghAvatarCache) w.__ghAvatarCache = new Map();
    return w.__ghAvatarCache;
  })();

  $effect(() => {
    src = null; failed = false;
    if (!email) { failed = true; return; }
    const key = email.toLowerCase().trim();
    let p = cache.get(key);
    if (!p) {
      p = ipc.avatarForEmail(key);
      cache.set(key, p);
    }
    p.then((path) => { src = convertFileSrc(path); })
     .catch(() => { failed = true; cache.delete(key); });
  });

  // Stable HSL fallback so each unique email gets its own swatch.
  function hueFor(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }
  function initialsOf(s: string | null | undefined): string {
    if (!s) return "?";
    const parts = s.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || s[0].toUpperCase();
  }
</script>

{#if src && !failed}
  <img
    class="avatar"
    style="width: {size}px; height: {size}px"
    src={src}
    alt={name ?? email ?? ""}
    onerror={() => { failed = true; }}
    loading="lazy"
  />
{:else}
  <span
    class="avatar fallback"
    style="width: {size}px; height: {size}px; font-size: {Math.max(8, Math.round(size * 0.42))}px;
           background: hsl({hueFor(email ?? name ?? '?')}, 55%, 42%)"
    title={name ?? email ?? ""}
  >{initialsOf(name ?? email ?? "?")}</span>
{/if}

<style>
  .avatar {
    display: inline-block;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
    line-height: 1;
    vertical-align: middle;
  }
  .fallback {
    color: #fff;
    font-weight: 700;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
  }
</style>
