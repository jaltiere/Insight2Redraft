import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { OwnerProfilePage } from "./OwnerProfilePage";

function renderAt(path = "/owners/1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/owners/:id" element={<OwnerProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders season records and best-weekly", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /Jack Altiere|JackA/ })).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByText("11-2")).toBeInTheDocument();
  expect(screen.getByText("1st")).toBeInTheDocument();
  expect(screen.getByText(/155\.2/)).toBeInTheDocument();
});

test("shows not-found on a 404", async () => {
  renderAt("/owners/404");
  expect(await screen.findByText(/owner not found/i)).toBeInTheDocument();
});

test("shows not-found for a non-numeric id", async () => {
  renderAt("/owners/abc");
  expect(await screen.findByText(/owner not found/i)).toBeInTheDocument();
});
