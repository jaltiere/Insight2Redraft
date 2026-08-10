import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

test("renders a fallback when a child throws", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  spy.mockRestore();
});

test("renders children when there is no error", () => {
  render(
    <ErrorBoundary>
      <p>ok</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("ok")).toBeInTheDocument();
});
