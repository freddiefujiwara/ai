import { test, expect } from "@playwright/test";

// muse staging gate: the staging preview must load, show the STAGING
// banner, and render the sign-in gate without console errors. Login is
// not performed here (read-only check): with no session the sign-in
// gate is the expected first screen.
test("muse staging page loads with banner and sign-in gate", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const resp = await page.goto("/muse/staging/");
  expect(resp.status()).toBe(200);
  await expect(page.getByText("STAGING")).toBeVisible();
  await expect(page.locator(".brand-name")).toHaveText("Muse");
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
// muse-gas /exec call with page.route. The API URL is baked in at build
// time, but it always points at script.google.com/macros/..., so one
// route pattern captures list/result (GET) and rename/delete (POST)
// regardless of which deployment the build was pointed at. All data
// below is dummy data. The result response is held on a gate promise
// (not a sleep) so the loading UI check is deterministic.
test("muse staging mocked session: titles, loading UI, rename and delete", async ({ page }) => {
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
      "muse:session:v1:staging",
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

  const resp = await page.goto("/muse/staging/");
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

  // Delete from the thread (dialog auto-accepted): a delete request is
  // sent and the app returns to the list without the deleted item.
  await page.locator(".thread-actions").getByRole("button", { name: "削除" }).click();
  await expect(page.locator(".req-title", { hasText: "付けた名前の会話" })).toBeVisible();
  await expect(page.locator(".req-title", { hasText: "新しい名前" })).toHaveCount(0);
  expect(sent.some((s) => s.action === "delete" && s.body && s.body.id === "e2e-1")).toBeTruthy();

  // Delete from the list as well: the last item goes and the empty
  // state shows.
  await page
    .locator(".request-item", { hasText: "付けた名前の会話" })
    .getByRole("button", { name: "削除" })
    .click();
  await expect(page.getByText("まだ会話がありません")).toBeVisible();
  expect(sent.some((s) => s.action === "delete" && s.body && s.body.id === "e2e-2")).toBeTruthy();
});

test("muse staging header keeps the brand on one line at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const resp = await page.goto("/muse/staging/");
  expect(resp.status()).toBe(200);
  const box = await page.locator(".brand-name").boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeLessThan(30);
});
