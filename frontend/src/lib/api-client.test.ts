import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { apiClient, isApiError } from "./api-client";
import { server } from "@/test/server";

describe("apiClient", () => {
  afterEach(() => localStorage.clear());

  it("returns parsed JSON on success", async () => {
    server.use(http.get("/api/seasons", () => HttpResponse.json([{ id: 1, year: 2024, status: "regular" }])));
    const data = await apiClient.get<{ id: number }[]>("/seasons");
    expect(data[0].id).toBe(1);
  });

  it("attaches the bearer token when present", async () => {
    localStorage.setItem("i2r_token", "abc.def");
    let seen: string | null = null;
    server.use(http.get("/api/me", ({ request }) => {
      seen = request.headers.get("authorization");
      return HttpResponse.json({ ok: true });
    }));
    await apiClient.get("/me");
    expect(seen).toBe("Bearer abc.def");
  });

  it("throws an ApiError with the status on non-2xx", async () => {
    server.use(http.get("/api/nope", () => HttpResponse.json({ detail: "boom" }, { status: 404 })));
    await expect(apiClient.get("/nope")).rejects.toMatchObject({ status: 404, detail: "boom" });
    try {
      await apiClient.get("/nope");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
    }
  });
});
