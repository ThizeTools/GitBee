<script lang="ts">
  import { ipc } from "$lib/ipc";
  import { ghAuth, loginWithPat } from "$lib/stores/github";
  import { logAppend } from "$lib/stores/logs";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let mode = $state<"oauth" | "pat">("oauth");
  let busy = $state(false);
  let pat = $state("");
  let oauthInfo = $state<{ userCode: string; uri: string } | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);

  async function startOauth() {
    error = null;
    busy = true;
    try {
      const r = await ipc.githubOauthStart();
      oauthInfo = { userCode: r.user_code, uri: r.verification_uri };
      // Pre-copy the user_code so the user only has to paste once they
      // land on the verification page.
      try { await navigator.clipboard.writeText(r.user_code); copied = true; } catch {}
      // Open the verification page in the browser. The user pastes the
      // code there.
      await openUrl(r.verification_uri);
      // Long-poll until GitHub authorizes — backend handles the polling
      // cadence, this just waits for the result.
      const u = await ipc.githubOauthAwait();
      ghAuth.set({ authenticated: true, login: u.login, avatarUrl: u.avatar_url });
      logAppend("info", `signed in to GitHub as ${u.login}`);
      oauthInfo = null;
    } catch (e) {
      error = String(e);
      logAppend("error", `github auth: ${e}`);
      try { await ipc.githubOauthCancel(); } catch {}
    } finally {
      busy = false;
    }
  }

  async function copyCode() {
    if (!oauthInfo) return;
    try { await navigator.clipboard.writeText(oauthInfo.userCode); copied = true; } catch {}
  }
  async function reopenUrl() {
    if (!oauthInfo) return;
    try { await openUrl(oauthInfo.uri); } catch {}
  }

  async function cancelOauth() {
    try { await ipc.githubOauthCancel(); } catch {}
    oauthInfo = null;
    busy = false;
  }

  async function submitPat() {
    if (!pat.trim()) return;
    error = null;
    busy = true;
    try {
      await loginWithPat(pat.trim());
      pat = "";
      logAppend("info", "GitHub PAT saved");
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel">
  <header class="hd">
    <span class="ico">⎈</span>
    <span>Connect to GitHub</span>
  </header>

  <div class="seg">
    <button class:active={mode === "oauth"} onclick={() => (mode = "oauth")}>Sign in with browser</button>
    <button class:active={mode === "pat"} onclick={() => (mode = "pat")}>Personal Access Token</button>
  </div>

  {#if mode === "oauth"}
    {#if !oauthInfo}
      <p class="hint">
        Opens GitHub in your browser, you paste a one-time code, GitBee
        detects it automatically. No password, no client secret.
      </p>
      <button class="primary" onclick={startOauth} disabled={busy}>
        {busy ? "Starting…" : "Sign in with GitHub"}
      </button>
    {:else}
      <p class="hint">
        On the page that just opened, paste this code:
      </p>
      <div class="code-row">
        <code class="user-code">{oauthInfo.userCode}</code>
        <button class="ghost" onclick={copyCode} title="Copy">
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p class="hint small">
        Browser tab didn't open?
        <button class="link" onclick={reopenUrl}>Open {oauthInfo.uri}</button>
      </p>
      <div class="oauth-wait">
        <div class="spinner"></div>
        <span class="waiting">Waiting for authorization…</span>
        <button class="ghost" onclick={cancelOauth}>Cancel</button>
      </div>
    {/if}
  {:else}
    <p class="hint">
      Generate a token at
      <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a>
      with <code>repo</code> + <code>read:user</code> + <code>read:org</code> scopes.
    </p>
    <input
      type="password"
      placeholder="ghp_… or github_pat_…"
      bind:value={pat}
      onkeydown={(e) => e.key === "Enter" && submitPat()}
      disabled={busy}
    />
    <button class="primary" onclick={submitPat} disabled={busy || !pat.trim()}>
      {busy ? "Validating…" : "Save token"}
    </button>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
    background: var(--bg-elev);
  }
  .hd { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; }
  .ico { color: var(--accent); font-size: 16px; }
  .seg { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .seg button {
    flex: 1; padding: 6px 10px; background: transparent; border: 0;
    color: var(--fg-muted); cursor: pointer; font-size: 11px;
  }
  .seg button.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .hint { font-size: 11px; color: var(--fg-muted); margin: 0; line-height: 1.5; }
  .hint a { color: var(--accent); }
  .hint code { font-family: "Cascadia Code", Consolas, monospace; font-size: 10px;
    background: var(--bg); padding: 1px 4px; border-radius: 2px; }
  input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 7px 10px; font-size: 12px;
    font-family: "Cascadia Code", Consolas, monospace;
  }
  input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 8px 14px; border-radius: 4px; cursor: pointer;
    font-weight: 600; font-size: 12px;
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .ghost {
    background: transparent; color: var(--fg-muted);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 6px 10px; cursor: pointer; font-size: 11px;
  }
  .ghost:hover { color: var(--fg); border-color: var(--fg-muted); }
  .err { color: var(--del); font-size: 11px; margin: 0; }
  .oauth-wait { display: flex; align-items: center; gap: 12px; }
  .waiting { color: var(--fg-muted); font-size: 11px; flex: 1; }
  .code-row {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 10px 14px;
  }
  .user-code {
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 22px; font-weight: 700;
    letter-spacing: 4px;
    color: var(--accent);
    flex: 1;
  }
  .small { font-size: 10px; }
  .link {
    background: transparent; border: 0; color: var(--accent);
    cursor: pointer; padding: 0; text-decoration: underline;
    font: inherit; font-size: 10px;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
