import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SeasonsPage } from "./SeasonsPage";
import { server } from "@/test/server";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeasonsPage />
    </QueryClientProvider>,
  );
}

test("renders seasons from the API", async () => {
  renderPage();
  expect(await screen.findByText("2024")).toBeInTheDocument();
  expect(screen.getByText("2023")).toBeInTheDocument();
});

test("shows an error state when the request fails", async () => {
  server.use(http.get("/api/seasons", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
  renderPage();
  expect(await screen.findByText(/couldn't load seasons/i)).toBeInTheDocument();
});
