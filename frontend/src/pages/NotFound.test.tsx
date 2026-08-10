import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { NotFound } from "./NotFound";

test("renders a 404 with a link home", () => {
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
  expect(screen.getByText("404")).toBeInTheDocument();
  expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /seasons/i })).toHaveAttribute("href", "/");
});
