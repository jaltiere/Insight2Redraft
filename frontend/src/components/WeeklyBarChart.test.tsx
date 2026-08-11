import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WeeklyBarChart } from "./WeeklyBarChart";

const scores = [
  { week: 1, points: 120.5, is_final: true },
  { week: 2, points: 98.0, is_final: true },
  { week: 3, points: 110.2, is_final: false },
];

test("renders one labeled bar per week with rounded value labels", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByText("W1")).toBeInTheDocument();
  expect(screen.getByText("W2")).toBeInTheDocument();
  expect(screen.getByText("W3")).toBeInTheDocument();
  expect(screen.getByText("121")).toBeInTheDocument(); // Math.round(120.5)
});

test("flags the non-final week as live for screen readers", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByText(/week 3 \(live\)/i)).toBeInTheDocument();
});

test("exposes an accessible summary label", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByRole("img", { name: /weekly points/i })).toBeInTheDocument();
});
