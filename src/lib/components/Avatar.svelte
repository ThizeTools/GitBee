<script lang="ts" module>
  // Process-wide cache so re-rendering rows doesn't re-hit the backend. Value
  // is a Promise so concurrent mounts coalesce into one IPC call. Capped at
  // 2000 emails, least recently used first out: a long session over many
  // authors used to grow an unbounded map on `window`. It is in this module
  // block, not the instance script, so every row shares one cache.
  import { LruMap } from "$lib/stores/lruMap";

  const AVATAR_CACHE_LIMIT = 2000;
  const cache = new LruMap<string, Promise<string>>(AVATAR_CACHE_LIMIT);
</script>

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


  // Rows are virtualized and recycled while scrolling, so a fetch for the
  // previous email can resolve after this instance already shows another one.
  // Each run gets its own `live` flag; the cleanup flips it so a superseded
  // run ignores its promise and never paints a stale image.
  $effect(() => {
    let live = true;
    src = null; failed = false;
    if (!email) { failed = true; return () => { live = false; }; }
    const key = email.toLowerCase().trim();
    let p = cache.get(key);
    if (!p) {
      p = ipc.avatarForEmail(key);
      cache.set(key, p);
    }
    p.then((path) => { if (live) src = convertFileSrc(path); })
     .catch(() => {
       // Drop only our own entry: a newer run may already have stored a retry.
       if (cache.get(key) === p) cache.delete(key);
       if (live) failed = true;
     });
    return () => { live = false; };
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
  <!-- No loading="lazy": WebKit often never starts a lazy load inside the
       scrolled, CSS-zoomed graph, so the avatar stayed blank after scrolling
       (bug: avatars vanish while scrolling on macOS). The row window already
       limits how many images mount, so lazy loading bought nothing here. -->
  <img
    class="avatar"
    style="width: {size}px; height: {size}px"
    src={src}
    alt={name ?? email ?? ""}
    onerror={() => { failed = true; }}
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
