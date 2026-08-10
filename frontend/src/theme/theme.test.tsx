import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

function Probe() {
  const { theme, setTheme, toggle } = useTheme();
  return (
    <div>
      <span>theme:{theme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

test("defaults to the OS preference (matchMedia stub matches=false -> light)", () => {
  renderProbe();
  expect(screen.getByText("theme:light")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("setTheme('dark') adds the .dark class and persists", async () => {
  renderProbe();
  await userEvent.click(screen.getByRole("button", { name: "dark" }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("i2r_theme")).toBe("dark");
});

test("toggle flips light <-> dark", async () => {
  renderProbe();
  await userEvent.click(screen.getByRole("button", { name: "toggle" }));
  expect(screen.getByText("theme:dark")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "toggle" }));
  expect(screen.getByText("theme:light")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("applies a stored preference on mount", () => {
  localStorage.setItem("i2r_theme", "dark");
  renderProbe();
  expect(screen.getByText("theme:dark")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
