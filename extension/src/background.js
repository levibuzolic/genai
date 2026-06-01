const PROVIDERS = {
  generateporn: {
    label: "GP",
    localAuthUrl: "http://localhost:5177/api/auth/token"
  },
  playbox: {
    label: "Playbox",
    localAuthUrl: "http://localhost:5177/api/playbox/auth/token"
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "auth-helper:sendAuthToLocal") {
    sendAuthToLocal(sender.tab?.id, message.provider)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  return false;
});

async function sendAuthToLocal(tabId, requestedProvider) {
  if (!tabId) {
    throw new Error("No active tab found.");
  }

  const provider = PROVIDERS[requestedProvider] ? requestedProvider : "generateporn";
  const token = await getTokenFromTab(tabId, provider);
  const expiresAt = getJwtExpiration(token);
  const response = await fetch(PROVIDERS[provider].localAuthUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      token,
      source: "chrome-extension"
    })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.ok) {
    throw new Error(body.error || `Local server rejected token: ${response.status}`);
  }

  return {
    ok: true,
    provider,
    label: PROVIDERS[provider].label,
    expiresAt: body.expiresAt || expiresAt
  };
}

async function getTokenFromTab(tabId, provider) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    world: "MAIN",
    args: [provider],
    func: async (providerName) => {
      const deadline = Date.now() + 5000;

      while (Date.now() < deadline) {
        let token = null;

        if (providerName === "playbox") {
          const response = await fetch("https://api.playbox.com/api/users/me-new", {
            credentials: "include",
            headers: {
              accept: "application/json"
            }
          }).catch(() => null);
          const body = response?.ok ? await response.json().catch(() => null) : null;
          token = body?.data?.accessToken || null;
        } else {
          token = await window.Clerk?.session?.getToken?.();
        }

        if (token) {
          return token;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      throw new Error(providerName === "playbox"
        ? "Playbox /api/users/me-new did not return an access token."
        : "window.Clerk.session.getToken() did not return a token.");
    }
  });

  const token = results?.[0]?.result;

  if (!token) {
    throw new Error("Unable to read auth token from the page.");
  }

  return token;
}

function getJwtExpiration(token) {
  if (!token || token.split(".").length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null;
  } catch {
    return null;
  }
}
