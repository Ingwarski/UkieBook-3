// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AuroraButton,
  AuroraField,
  AuroraIconButton,
  AuroraStatusBadge,
} from "../../components/aurora";

describe("Aurora accessible primitives", () => {
  it("exposes loading and disabled button state without changing its name", () => {
    render(<AuroraButton busy>Зберегти</AuroraButton>);

    const button = screen.getByRole("button", { name: "Зберегти" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires an accessible name for an icon-only control", () => {
    render(
      <AuroraIconButton aria-label="Пошук">
        <svg viewBox="0 0 24 24" />
      </AuroraIconButton>,
    );

    expect(screen.getByRole("button", { name: "Пошук" })).toBeTruthy();
  });

  it("associates labels, help and textual errors with a field", () => {
    render(
      <AuroraField
        description="Видима підказка"
        error="Укажіть назву"
        id="book-title"
        label="Назва книжки"
        required
      />,
    );

    const input = screen.getByLabelText(/Назва книжки/);
    expect(input.getAttribute("aria-describedby")).toBe("book-title-description book-title-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Укажіть назву");
  });

  it("communicates status in text instead of color alone", () => {
    render(<AuroraStatusBadge label="Очікує перевірки" tone="warning" />);

    expect(screen.getByText("Очікує перевірки")).toBeTruthy();
  });
});
