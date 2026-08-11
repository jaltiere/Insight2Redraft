import { expect, test } from "vitest";
import { ownerName, teamRecord, ordinal } from "./standings";
import type { OwnerRef } from "@/types/api";

const owner: OwnerRef = { id: 1, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null };

test("ownerName prefers display_name, falls back to first+last, dash when null", () => {
  expect(ownerName(owner)).toBe("Jack Altiere");
  expect(ownerName({ ...owner, display_name: "JackA" })).toBe("JackA");
  expect(ownerName(null)).toBe("—");
});

test("teamRecord shows ties only when present", () => {
  expect(teamRecord({ wins: 9, losses: 4, ties: 0 })).toBe("9-4");
  expect(teamRecord({ wins: 9, losses: 4, ties: 1 })).toBe("9-4-1");
});

test("ordinal formats English ordinals", () => {
  expect(ordinal(1)).toBe("1st");
  expect(ordinal(2)).toBe("2nd");
  expect(ordinal(3)).toBe("3rd");
  expect(ordinal(4)).toBe("4th");
  expect(ordinal(11)).toBe("11th");
  expect(ordinal(21)).toBe("21st");
});
