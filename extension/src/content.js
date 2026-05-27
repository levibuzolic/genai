const PANEL_ID = "gp-auth-helper-panel";
const AUTH_REFRESH_MS = 30000;

const state = {
  authInFlight: false,
  lastAuthExpiresAt: null
};

init();

function init() {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <span class="gp-panel__dot" data-role="dot" aria-hidden="true"></span>
    <span class="gp-panel__label" data-role="state">GP Auth</span>
    <button class="gp-panel__button" type="button" data-action="auth" title="Send auth to local app" aria-label="Send auth to local app">Sync</button>
    <button class="gp-panel__icon" type="button" data-action="hide" title="Hide GP Auth Helper" aria-label="Hide GP Auth Helper">x</button>
  `;

  document.documentElement.appendChild(panel);

  panel.querySelector('[data-action="auth"]').addEventListener("click", () => sendAuthToLocal());
  panel.querySelector('[data-action="hide"]').addEventListener("click", () => {
    panel.hidden = true;
  });

  startAutomaticAuthRefresh();
}

function startAutomaticAuthRefresh() {
  refreshAuthSilently();
  window.setInterval(refreshAuthSilently, AUTH_REFRESH_MS);
  window.addEventListener("focus", refreshAuthSilently);
}

async function refreshAuthSilently() {
  if (state.authInFlight) {
    return;
  }

  state.authInFlight = true;

  try {
    await sendAuthToLocal({
      silent: true
    });
  } catch {
    // The local app may not be running yet; manual auth will surface errors.
  } finally {
    state.authInFlight = false;
  }
}

async function sendAuthToLocal(options = {}) {
  const silent = Boolean(options.silent);

  if (!silent) {
    setPanelState("Syncing...");
  }

  const response = await chrome.runtime.sendMessage({
    type: "gp-auth:sendAuthToLocal"
  });

  if (!response?.ok) {
    const message = response?.error || "Unable to send auth token.";

    if (!silent) {
      setPanelState("Auth failed", "error");
    }

    throw new Error(message);
  }

  state.lastAuthExpiresAt = response.expiresAt || null;
  renderState();

  if (!silent) {
    const suffix = response.expiresAt
      ? ` until ${new Date(response.expiresAt).toLocaleTimeString()}`
      : "";
    setPanelState(`Synced${suffix}`, "ok");
  }

  return response;
}

function renderState() {
  const label = document.querySelector(`#${PANEL_ID} [data-role="state"]`);

  if (!label) {
    return;
  }

  label.textContent = state.lastAuthExpiresAt
    ? `GP Auth ${new Date(state.lastAuthExpiresAt).toLocaleTimeString()}`
    : "GP Auth";
  setPanelTone("ok");
}

function setPanelState(message, tone = "neutral") {
  const label = document.querySelector(`#${PANEL_ID} [data-role="state"]`);

  if (label) {
    label.textContent = message;
  }

  setPanelTone(tone);
}

function setPanelTone(tone) {
  const panel = document.getElementById(PANEL_ID);

  if (!panel) {
    return;
  }

  panel.dataset.tone = tone;
}
