import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { MappingPage } from "./MappingPage";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/leagues/9/mapping") {
  return renderWithAuth(
    <Routes><Route path="/admin/leagues/:id/mapping" element={<MappingPage />} /></Routes>,
    { route: path },
  );
}

test("renders team rows with assigned + unassigned owners", async () => {
  renderAt();
  expect(await screen.findByText("jaltiere")).toBeInTheDocument();
  expect(screen.getByText(/Jack Altiere|JackA/)).toBeInTheDocument(); // assigned row
  // both the summary line and the unassigned row's picker mention "unassigned"
  expect(screen.getAllByText(/unassigned/i).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/2 teams · 1 unassigned/)).toBeInTheDocument();
});

test("assigning the unassigned team via the picker updates the row", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /assign/i }));
  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  await userEvent.click(await screen.findByRole("button", { name: /Maria Pappas/ }));
  expect(await screen.findByText(/Pappas/)).toBeInTheDocument();
});

test("renders not-found for a non-numeric league id", async () => {
  renderAt("/admin/leagues/abc/mapping");
  expect(await screen.findByText(/league not found/i)).toBeInTheDocument();
});
