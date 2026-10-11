import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { dispatchWorkflow } from "../src/index";

afterEach(() => vi.restoreAllMocks());

function mockFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}

describe("scheduled", () => {
  it("dispatches the digest workflow on main", async () => {
    const calls = mockFetch(new Response(null, { status: 204 }));
    await worker.scheduled(createScheduledController({ cron: "0 2 * * *" }), env);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://api.github.com/repos/vinhhieu21/telegram-bot/actions/workflows/digest.yml/dispatches");
    expect(call!.init.method).toBe("POST");
    expect(JSON.parse(call!.init.body as string)).toEqual({ ref: "main" });
    const headers = call!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["User-Agent"]).toBeTruthy();
  });
});

describe("dispatchWorkflow", () => {
  it("retries 5xx, network errors and 429, then gives up after 3 attempts", async () => {
    const calls = mockFetch(
      new Response("bad gateway", { status: 502 }),
      new TypeError("network connection lost"),
      new Response("slow down", { status: 429 }),
    );
    await expect(dispatchWorkflow(env, 0)).rejects.toThrow(/after 3 attempts: GitHub 429/);
    expect(calls).toHaveLength(3);
  });

  it("succeeds after a transient failure", async () => {
    const calls = mockFetch(new Response("bad gateway", { status: 502 }), new Response(null, { status: 204 }));
    await dispatchWorkflow(env, 0);
    expect(calls).toHaveLength(2);
  });

  it("fails fast on a permanent 4xx", async () => {
    const calls = mockFetch(new Response('{"message":"Bad credentials"}', { status: 401 }));
    await expect(dispatchWorkflow(env, 0)).rejects.toThrow("GitHub 401");
    expect(calls).toHaveLength(1);
  });
});
