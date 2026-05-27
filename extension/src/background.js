const LOCAL_AUTH_URL = "http://localhost:5177/api/auth/token";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "gp-auth:sendAuthToLocal") {
    sendAuthToLocal(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  return false;
});

async function sendAuthToLocal(tabId) {
  if (!tabId) {
    throw new Error("No active tab found.");
  }

  const token = await getClerkTokenFromTab(tabId);
  const expiresAt = getJwtExpiration(token);
  const response = await fetch(LOCAL_AUTH_URL, {
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
    expiresAt: body.expiresAt || expiresAt
  };
}

async function getClerkTokenFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    world: "MAIN",
    func: async () => {
      const deadline = Date.now() + 5000;

      while (Date.now() < deadline) {
        const token = await window.Clerk?.session?.getToken?.();

        if (token) {
          return token;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      throw new Error("window.Clerk.session.getToken() did not return a token.");
    }
  });

  const token = results?.[0]?.result;

  if (!token) {
    throw new Error("Unable to read Clerk token from the page.");
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
