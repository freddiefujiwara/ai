import { test, expect } from "@playwright/test";

// ai staging gate: the staging preview must load, show the STAGING
// banner, and render the sign-in gate without console errors. Login is
// not performed here (read-only check): with no session the sign-in
// gate is the expected first screen.
test("ai staging page loads with banner and sign-in gate", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.getByText("STAGING")).toBeVisible();
  await expect(page.locator(".brand-name")).toHaveText("AI");
  await expect(page.getByText("Googleログインが必要です")).toBeVisible();
  const footer = page.locator(".site-footer");
  await expect(footer).toBeVisible();
  const topLink = footer.getByRole("link", { name: /トップ/ });
  await expect(topLink).toHaveAttribute("href", "https://freddiefujiwara.com/");
  await expect(footer.locator(".copy")).toContainText("freddiefujiwara.com");
  await expect(footer.locator(".copy")).toContainText("©");
  expect(errors).toEqual([]);
});

// Logged-in flows cannot use a real Google sign-in in CI, so this test
// seeds a dummy session in localStorage (staging key) and mocks every
// ai-gas /exec call with page.route. The API URL is baked in at build
// time, but it always points at script.google.com/macros/..., so one
// route pattern captures list/result (GET) and rename/delete (POST)
// regardless of which deployment the build was pointed at. All data
// below is dummy data. The result response is held on a gate promise
// (not a sleep) so the loading UI check is deterministic.
test("ai staging mocked session: titles, loading UI, rename and delete", async ({ page }) => {
  const state = {
    requests: [
      {
        id: "e2e-1", status: "replied", round: 1,
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
        title: "", preview: "最初の依頼文のプレビュー",
      },
      {
        id: "e2e-2", status: "replied", round: 2,
        created_at: "2026-11-25T02:00:00.000Z", last_activity_at: "2026-11-25T02:05:00.000Z",
        title: "付けた名前の会話", preview: "二件目のプレビュー",
      },
    ],
  };
  const sent = [];
  let releaseResult;
  const resultGate = new Promise((resolve) => { releaseResult = resolve; });
  const gateTimer = setTimeout(() => releaseResult(), 20000);

  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
  });

  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    let body = null;
    if (req.method() === "POST") {
      try {
        body = JSON.parse(req.postData() || "{}");
        action = body.action;
      } catch {
        // keep the GET-derived action (null for POSTs)
      }
    }
    sent.push({ method: req.method(), action, body });
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") return json({ ok: true, requests: state.requests });
    if (action === "result") {
      await resultGate;
      const r = state.requests.find((x) => x.id === url.searchParams.get("id"));
      if (!r) return json({ ok: false, error: "request not found" });
      return json({
        ok: true, id: r.id, status: r.status, round: r.round, title: r.title,
        created_at: r.created_at, last_activity_at: r.last_activity_at,
        messages: [
          { round: 1, direction: "out", text: "こんにちは、これはモックの依頼です", at: "2026-11-25T01:00:00.000Z" },
          { round: 1, direction: "in", text: "モックの返信です", at: "2026-11-25T01:05:00.000Z" },
        ],
      });
    }
    if (action === "rename") {
      const r = state.requests.find((x) => x.id === body.id);
      if (r) r.title = body.title || "";
      return json({ ok: true, id: body.id, title: body.title || "" });
    }
    if (action === "delete") {
      state.requests = state.requests.filter((x) => x.id !== body.id);
      return json({ ok: true, id: body.id });
    }
    return json({ ok: false, error: "unknown action" });
  });

  page.on("dialog", (dialog) => dialog.accept());

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);

  // List: an unnamed conversation shows its preview, a named one its title.
  await expect(page.locator(".req-title", { hasText: "最初の依頼文のプレビュー" })).toBeVisible();
  await expect(page.locator(".req-title", { hasText: "付けた名前の会話" })).toBeVisible();

  // Opening the thread holds on the gated result: the loading UI shows
  // and the composer is disabled until the response is released.
  await page
    .locator(".request-item", { hasText: "最初の依頼文のプレビュー" })
    .locator(".request-row")
    .click();
  await expect(page.locator(".thread-loading")).toContainText("読み込んでいます");
  await expect(page.locator(".composer textarea")).toBeDisabled();
  releaseResult();
  clearTimeout(gateTimer);
  await expect(page.getByText("モックの返信です")).toBeVisible();
  await expect(page.locator(".thread-loading")).toHaveCount(0);
  await expect(page.locator(".composer textarea")).toBeEnabled();

  // Rename from the thread: Enter saves and a rename request is sent.
  await page.getByRole("button", { name: "名前を変更" }).click();
  await page.locator(".title-input").fill("新しい名前");
  await page.locator(".title-input").press("Enter");
  await expect(page.locator(".thread-title")).toHaveText("新しい名前");
  expect(
    sent.some((s) => s.action === "rename" && s.body && s.body.id === "e2e-1" && s.body.title === "新しい名前"),
  ).toBeTruthy();

  // Delete from the thread: the confirmation expands inline (no
  // browser dialog). Cancel closes it without sending anything;
  // confirming sends the delete and returns to the list without
  // the deleted item.
  await page.locator(".thread-actions").getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.locator(".thread-actions .delete-confirm")).toContainText("この会話を削除しますか");
  await page
    .locator(".thread-actions .delete-confirm")
    .getByRole("button", { name: "キャンセル" })
    .click();
  await expect(page.locator(".thread-actions .delete-confirm")).toHaveCount(0);
  expect(sent.some((s) => s.action === "delete")).toBeFalsy();
  await page.locator(".thread-actions").getByRole("button", { name: "削除", exact: true }).click();
  await page
    .locator(".thread-actions .delete-confirm")
    .getByRole("button", { name: "本当に削除" })
    .click();
  await expect(page.locator(".req-title", { hasText: "付けた名前の会話" })).toBeVisible();
  await expect(page.locator(".req-title", { hasText: "新しい名前" })).toHaveCount(0);
  expect(sent.some((s) => s.action === "delete" && s.body && s.body.id === "e2e-1")).toBeTruthy();

  // Delete from the list as well (same two-step inline
  // confirmation): the last item goes and the empty state shows.
  const lastItem = page.locator(".request-item", { hasText: "付けた名前の会話" });
  await lastItem.getByRole("button", { name: "削除", exact: true }).click();
  // Once the confirmation opens, the row no longer shows the title,
  // so a hasText filter cannot find it anymore. Only one item is
  // left at this point: address it directly.
  const onlyItem = page.locator(".request-item");
  await expect(onlyItem.locator(".delete-confirm")).toContainText("この会話を削除しますか");
  await onlyItem
    .locator(".delete-confirm")
    .getByRole("button", { name: "本当に削除" })
    .click();
  await expect(page.getByText("まだ会話がありません")).toBeVisible();
  expect(sent.some((s) => s.action === "delete" && s.body && s.body.id === "e2e-2")).toBeTruthy();
});

test("ai staging header keeps the brand on one line at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  const box = await page.locator(".brand-name").boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeLessThan(30);
});

// Regression: long conversation titles used to overflow the viewport
// at phone width (the row button could not shrink below the title's
// min-content). With the same mocked-session setup as above, a list
// holding very long dummy titles must stay inside a 390px viewport:
// no horizontal scrolling, and every title / row box inside the
// viewport with the ellipsis engaged. The thread header title is
// checked the same way.
test("ai staging long titles do not overflow at phone width", async ({ page }) => {
  const LONG =
    "これはとても長いダミーの会話タイトルです。画面幅に収まるかどうかを確認するための文字列で、まだまだ続きます。";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") {
      return json({
        ok: true,
        requests: [
          {
            id: "long-1", status: "replied", round: 1,
            created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
            title: "", preview: LONG,
          },
          {
            id: "long-2", status: "pending", round: 3,
            created_at: "2026-11-25T02:00:00.000Z", last_activity_at: "2026-11-25T02:05:00.000Z",
            title: LONG, preview: "短いプレビュー",
          },
        ],
      });
    }
    if (action === "result") {
      const id = url.searchParams.get("id");
      return json({
        ok: true, id, status: "replied", round: 1, title: LONG,
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
        messages: [
          { round: 1, direction: "out", text: LONG, at: "2026-11-25T01:00:00.000Z" },
          { round: 1, direction: "in", text: "モックの返信です", at: "2026-11-25T01:05:00.000Z" },
        ],
      });
    }
    return json({ ok: false, error: "unknown action" });
  });

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.locator(".req-title").first()).toBeVisible();

  // No horizontal overflow anywhere in the document.
  const listOverflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(listOverflow.scrollWidth).toBeLessThanOrEqual(listOverflow.innerWidth);

  // Every row and title box stays inside the viewport.
  const items = page.locator(".request-item");
  await expect(items).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const itemBox = await items.nth(i).boundingBox();
    expect(itemBox).not.toBeNull();
    expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(390);
    const titleBox = await items.nth(i).locator(".req-title").boundingBox();
    expect(titleBox).not.toBeNull();
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(390);
  }

  // The thread header with the same long title also stays inside.
  await items.first().locator(".request-row").click();
  await expect(page.getByText("モックの返信です")).toBeVisible();
  const threadOverflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(threadOverflow.scrollWidth).toBeLessThanOrEqual(threadOverflow.innerWidth);
  const threadTitleBox = await page.locator(".thread-title").boundingBox();
  expect(threadTitleBox).not.toBeNull();
  expect(threadTitleBox.x + threadTitleBox.width).toBeLessThanOrEqual(390);
});

// Opening a thread from the list lands at the bottom (latest
// message), like a chat screen. The mocked conversation is far
// taller than the viewport, so after the (gated) load completes the
// page must be scrolled to the bottom and the last message must be
// inside the viewport. Polling refreshes do not re-scroll (only the
// initial open does), which this test does not need to simulate.
test("ai staging opening a thread scrolls to the latest message", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") {
      return json({
        ok: true,
        requests: [
          {
            id: "scroll-1", status: "replied", round: 15,
            created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T03:00:00.000Z",
            title: "長い会話", preview: "長い会話のプレビュー",
          },
        ],
      });
    }
    if (action === "result") {
      const messages = [];
      for (let i = 1; i <= 30; i++) {
        messages.push({
          round: i,
          direction: i % 2 === 1 ? "out" : "in",
          text: i === 30 ? "最後のメッセージです" : `ダミーメッセージ ${i} 番目です`,
          at: "2026-11-25T01:00:00.000Z",
        });
      }
      return json({
        ok: true, id: "scroll-1", status: "replied", round: 15, title: "長い会話",
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T03:00:00.000Z",
        messages,
      });
    }
    return json({ ok: false, error: "unknown action" });
  });

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await page.locator(".request-item").first().locator(".request-row").click();
  await expect(page.getByText("最後のメッセージです")).toBeAttached();

  // The page is scrolled to (within a few px of) the bottom...
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollHeight - (window.scrollY + window.innerHeight);
      }),
    )
    .toBeLessThanOrEqual(4);

  // ...and the last message's box is inside the viewport.
  const lastBox = await page.locator(".bubble").last().boundingBox();
  expect(lastBox).not.toBeNull();
  expect(lastBox.y).toBeGreaterThanOrEqual(0);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(844);
});

// Per-thread URLs: opening a conversation from the list rewrites
// the URL to /ai/staging/<id>, a reload (or a direct visit to
// that URL) reopens the same conversation, and the browser back
// button returns to the list URL. Same mocked-session setup as
// above; all data is dummy data.
test("ai staging per-thread URLs: open, reload, back and deep link", async ({ page }) => {
  const requests = [
    {
      id: "route-1", status: "replied", round: 1,
      created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
      title: "ルート確認用の会話1", preview: "一件目のプレビュー",
    },
    {
      id: "route-2", status: "replied", round: 1,
      created_at: "2026-11-25T02:00:00.000Z", last_activity_at: "2026-11-25T02:05:00.000Z",
      title: "ルート確認用の会話2", preview: "二件目のプレビュー",
    },
  ];
  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") return json({ ok: true, requests });
    if (action === "result") {
      const r = requests.find((x) => x.id === url.searchParams.get("id"));
      if (!r) return json({ ok: false, error: "request not found" });
      return json({
        ok: true, id: r.id, status: r.status, round: r.round, title: r.title,
        created_at: r.created_at, last_activity_at: r.last_activity_at,
        messages: [
          { round: 1, direction: "out", text: `${r.id} への依頼です`, at: r.created_at },
          { round: 1, direction: "in", text: `${r.id} への返信です`, at: r.last_activity_at },
        ],
      });
    }
    return json({ ok: false, error: "unknown action" });
  });

  // Open from the list: the URL becomes the thread URL.
  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await page
    .locator(".request-item", { hasText: "ルート確認用の会話1" })
    .locator(".request-row")
    .click();
  await expect(page.getByText("route-1 への返信です")).toBeVisible();
  await expect(page).toHaveURL(/\/ai\/staging\/route-1$/);

  // Reload: the same conversation reopens directly from the URL.
  await page.reload();
  await expect(page.getByText("route-1 への返信です")).toBeVisible();
  await expect(page.locator(".thread-title")).toHaveText("ルート確認用の会話1");
  await expect(page).toHaveURL(/\/ai\/staging\/route-1$/);

  // Browser back: back to the list and the list URL.
  await page.goBack();
  await expect(page.locator(".req-title", { hasText: "ルート確認用の会話2" })).toBeVisible();
  await expect(page).toHaveURL(/\/ai\/staging\/$/);

  // Deep link: visiting a thread URL directly opens that thread.
  await page.goto("/ai/staging/route-2");
  await expect(page.getByText("route-2 への返信です")).toBeVisible();
  await expect(page.locator(".thread-title")).toHaveText("ルート確認用の会話2");
});

// List auto-refresh (reader-style background polling): while the
// list is on screen it re-fetches every 60s in the background, and a
// reply that lands in the meantime is flagged with an unread dot on
// the row and a "未読 N" pill, until the thread is opened. The page
// clock is faked so the 60s interval fires deterministically; all
// data is dummy data and every /exec call is mocked as above.
test("ai staging list auto-refresh flags unread replies until opened", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-25T03:00:00.000Z") });
  const state = {
    requests: [
      {
        id: "poll-1", status: "pending", round: 1,
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:00:00.000Z",
        title: "", preview: "自動更新確認用の会話",
      },
    ],
  };
  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
    // Seen storage initialized (empty): a new reply counts as unread.
    if (localStorage.getItem("ai:seen:v1:staging") === null) {
      localStorage.setItem("ai:seen:v1:staging", "{}");
    }
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") return json({ ok: true, requests: state.requests });
    if (action === "result") {
      const r = state.requests.find((x) => x.id === url.searchParams.get("id"));
      if (!r) return json({ ok: false, error: "request not found" });
      return json({
        ok: true, id: r.id, status: r.status, round: r.round, title: r.title,
        created_at: r.created_at, last_activity_at: r.last_activity_at,
        messages: [
          { round: 1, direction: "out", text: "自動更新の確認用リクエストです", at: "2026-11-25T01:00:00.000Z" },
          { round: 1, direction: "in", text: "自動更新で届いた返信です", at: "2026-11-25T01:05:00.000Z" },
        ],
      });
    }
    return json({ ok: false, error: "unknown action" });
  });

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.locator(".req-title", { hasText: "自動更新確認用の会話" })).toBeVisible();
  await expect(page.locator(".unread-dot")).toHaveCount(0);
  await expect(page.locator(".unread-pill")).toHaveCount(0);

  // The reply lands on the server; one polling interval later the
  // list has picked it up on its own and flags it unread.
  state.requests = [
    { ...state.requests[0], status: "replied", last_activity_at: "2026-11-25T01:05:00.000Z" },
  ];
  await page.clock.runFor(61_000);
  await expect(page.locator(".unread-dot")).toBeVisible();
  await expect(page.locator(".unread-pill")).toContainText("未読 1");

  // Opening the thread reads the reply; back on the list the flag
  // is gone.
  await page.locator(".request-item").first().locator(".request-row").click();
  await expect(page.getByText("自動更新で届いた返信です")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".req-title", { hasText: "自動更新確認用の会話" })).toBeVisible();
  await expect(page.locator(".unread-dot")).toHaveCount(0);
  await expect(page.locator(".unread-pill")).toHaveCount(0);
});

// Thread view: the header refresh button also appears while a
// conversation is open and re-fetches that conversation in the
// background (same gated-response technique as above, no blocking
// loading UI). Reply attachments (attachments: [{name, url}] on
// result messages) render as thumbnails under the message text,
// each linked to the original url. The dummy image url is
// intercepted and served a 1x1 PNG so the thumbnail really loads.
// All data below is dummy data.
test("ai staging thread header refresh and reply attachments", async ({ page }) => {
  const IMG_URL = "https://example.com/e2e-dummy.png";
  const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const baseMessages = [
    { round: 1, direction: "out", text: "添付確認の依頼です", at: "2026-11-25T01:00:00.000Z" },
    { round: 1, direction: "in", text: "返信です", at: "2026-11-25T01:05:00.000Z" },
  ];
  let resultCalls = 0;
  let releaseSecond;
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const gateTimer = setTimeout(() => releaseSecond(), 20000);

  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
    if (localStorage.getItem("ai:seen:v1:staging") === null) {
      localStorage.setItem("ai:seen:v1:staging", "{}");
    }
  });
  await page.route("https://example.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX });
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") {
      return json({
        ok: true,
        requests: [
          {
            id: "attach-1", status: "replied", round: 1,
            created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
            title: "", preview: "添付確認の依頼です",
          },
        ],
      });
    }
    if (action === "result") {
      resultCalls += 1;
      if (resultCalls > 1) await secondGate;
      const messages = resultCalls > 1
        ? [
            baseMessages[0],
            {
              ...baseMessages[1],
              attachments: [{ name: "e2e-dummy.png", url: IMG_URL }],
            },
          ]
        : baseMessages;
      return json({
        ok: true, id: "attach-1", status: "replied", round: 1, title: "",
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:05:00.000Z",
        messages,
      });
    }
    return json({ ok: false, error: "unknown action" });
  });

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await page
    .locator(".request-item", { hasText: "添付確認の依頼です" })
    .locator(".request-row")
    .click();
  await expect(page.getByText("返信です")).toBeVisible();
  expect(resultCalls).toBe(1);
  // No attachments in the first payload: no thumbnails yet.
  await expect(page.locator(".attachment-img")).toHaveCount(0);

  // The header refresh button is available in the thread view too.
  const refresh = page.locator(".site-nav .session-note .nav-refresh");
  await expect(refresh).toBeVisible();
  await expect(refresh).toHaveText("更新");

  // Clicking re-fetches the open conversation in the background:
  // busy label + disabled while in flight, thread stays on screen.
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveText("更新中…");
  await expect(page.locator(".thread-loading")).toHaveCount(0);
  await expect(page.getByText("返信です")).toBeVisible();
  releaseSecond();
  clearTimeout(gateTimer);

  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveText("更新");
  expect(resultCalls).toBe(2);

  // The refreshed payload carries the attachment: a thumbnail
  // under the reply text, wrapped in a link to the original url.
  const img = page.locator(".bubble.in .attachment-img");
  await expect(img).toHaveCount(1);
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", IMG_URL);
  const link = page.locator(".bubble.in .attachment-link");
  await expect(link).toHaveAttribute("href", IMG_URL);
  // The outgoing bubble has no attachments.
  await expect(page.locator(".bubble.out .attachment-img")).toHaveCount(0);
});

// Header layout follows reader: the manual refresh button sits in
// the global header's session-note area (class "ghost nav-refresh",
// label switches to "更新中…" while running), the unread pill sits
// in the same header area before it, and neither lives in the list
// action row any more. The refresh runs the same background update
// as the polling, so the list stays on screen while it is in flight
// (the second list response is gated to observe that state).
test("ai staging header refresh matches reader layout and background behavior", async ({ page }) => {
  const state = {
    requests: [
      {
        id: "refresh-1", status: "pending", round: 1,
        created_at: "2026-11-25T01:00:00.000Z", last_activity_at: "2026-11-25T01:00:00.000Z",
        title: "", preview: "手動更新確認用の会話",
      },
    ],
  };
  let listCalls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const gateTimer = setTimeout(() => releaseRefresh(), 20000);

  await page.addInitScript(() => {
    localStorage.setItem(
      "ai:session:v1:staging",
      JSON.stringify({ token: "e2e-dummy-session", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" }),
    );
    if (localStorage.getItem("ai:seen:v1:staging") === null) {
      localStorage.setItem("ai:seen:v1:staging", "{}");
    }
  });
  await page.route(/script\.google\.com\/macros\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action");
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() || "{}").action;
      } catch {
        // keep the GET-derived action
      }
    }
    const json = (obj) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (action === "list") {
      listCalls += 1;
      if (listCalls > 1) await refreshGate;
      return json({ ok: true, requests: state.requests });
    }
    return json({ ok: false, error: "unknown action" });
  });

  const resp = await page.goto("/ai/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.locator(".req-title", { hasText: "手動更新確認用の会話" })).toBeVisible();

  // Position: inside the header's session-note, not the list row.
  const refresh = page.locator(".site-nav .session-note .nav-refresh");
  await expect(refresh).toBeVisible();
  await expect(refresh).toHaveText("更新");
  await expect(page.locator(".chat-actions .nav-refresh")).toHaveCount(0);
  await expect(page.locator(".chat-actions button")).toHaveCount(1);

  // The reply lands; a manual refresh picks it up in the background.
  state.requests = [
    { ...state.requests[0], status: "replied", last_activity_at: "2026-11-25T01:05:00.000Z" },
  ];
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveText("更新中…");
  // The current list is not replaced by a blocking loading row.
  await expect(page.locator(".req-title", { hasText: "手動更新確認用の会話" })).toBeVisible();
  releaseRefresh();
  clearTimeout(gateTimer);

  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveText("更新");
  await expect(page.locator(".unread-dot")).toBeVisible();
  await expect(page.locator(".site-nav .session-note .unread-pill")).toContainText("未読 1");
  await expect(page.locator(".chat-actions .unread-pill")).toHaveCount(0);
  expect(listCalls).toBe(2);
});
