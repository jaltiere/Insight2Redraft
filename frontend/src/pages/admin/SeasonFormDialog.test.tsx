import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { SeasonFormDialog } from "./SeasonFormDialog";
import { renderWithAuth } from "@/test/renderWithAuth";
import { Button } from "@/components/ui/button";

afterEach(() => localStorage.clear());

function openCreate() {
  return renderWithAuth(<SeasonFormDialog trigger={<Button>New season</Button>} />);
}

test("Create stays disabled until the year is a valid number", async () => {
  openCreate();
  await userEvent.click(screen.getByRole("button", { name: /new season/i }));

  const create = screen.getByRole("button", { name: /^create$/i });
  expect(create).toBeDisabled(); // year starts empty
  expect(screen.getByText(/year must be a whole number/i)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText(/year/i), "20x4");
  expect(create).toBeDisabled();

  await userEvent.clear(screen.getByLabelText(/year/i));
  await userEvent.type(screen.getByLabelText(/year/i), "2024");
  expect(create).toBeEnabled();
});

test("a non-numeric playoff field blocks submission", async () => {
  openCreate();
  await userEvent.click(screen.getByRole("button", { name: /new season/i }));
  await userEvent.type(screen.getByLabelText(/year/i), "2024");

  const field = screen.getByLabelText(/playoff teams per league/i);
  await userEvent.clear(field);
  expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

  await userEvent.type(field, "0");
  expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  expect(screen.getByText(/playoff teams per league must be a whole number/i)).toBeInTheDocument();

  await userEvent.clear(field);
  await userEvent.type(field, "2");
  expect(screen.getByRole("button", { name: /^create$/i })).toBeEnabled();
});

test("junk in NFL playoff weeks blocks submission instead of being silently dropped", async () => {
  openCreate();
  await userEvent.click(screen.getByRole("button", { name: /new season/i }));
  await userEvent.type(screen.getByLabelText(/year/i), "2024");
  await userEvent.type(screen.getByLabelText(/nfl playoff weeks/i), "15, sixteen, 17");

  expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  expect(screen.getByText(/nfl playoff weeks must be whole numbers/i)).toBeInTheDocument();
});
