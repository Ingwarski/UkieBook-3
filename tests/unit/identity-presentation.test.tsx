// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorProfileScreen, LoginScreen } from "../../components/identity";

describe("UNIT-01 identity presentation", () => {
  it("renders the canonical S-03 copy and only the two named OAuth choices", () => {
    render(
      <LoginScreen
        facebookAction="/api/auth/facebook/start"
        googleAction="/api/auth/google/start"
        returnTo="/cart"
        returnHref="/cart"
      />,
    );

    expect(screen.getByRole("heading", { name: "Вхід" })).toBeTruthy();
    expect(screen.getByText("Вхід потрібен для покупки чи публікації")).toBeTruthy();
    const google = screen.getByRole("button", { name: "Увійти через Google" });
    expect(google).toBeTruthy();
    const googleMark = google.querySelector('img[src="/brand/google-g.png"]');
    expect(googleMark?.getAttribute("alt")).toBe("");
    expect(googleMark?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Увійти через Facebook" })).toBeTruthy();
    expect(document.querySelector('form[action="/api/auth/google/start"] input[name="returnTo"]')?.getAttribute("value")).toBe("/cart");
    expect(screen.queryByLabelText(/парол/i)).toBeNull();
  });

  it("keeps an OAuth error textual and prevents a repeated pending provider action", () => {
    render(
      <LoginScreen
        error="Не вдалося увійти через Google. Спробуйте ще раз."
        facebookAction="/api/auth/facebook/start"
        googleAction="/api/auth/google/start"
        pendingProvider="google"
        returnTo="/"
        returnHref="/"
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Не вдалося увійти через Google");
    const google = screen.getByRole("button", { name: "Увійти через Google" });
    expect(google.getAttribute("aria-busy")).toBe("true");
    expect((google as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Google");
  });

  it("uses the official mark in a named home link without duplicating its accessible name", () => {
    render(
      <LoginScreen
        facebookAction="/api/auth/facebook/start"
        googleAction="/api/auth/google/start"
        returnTo="/"
        returnHref="/"
      />,
    );

    const home = screen.getByRole("link", { name: "UkieBook — головна" });
    const mark = home.querySelector("img");
    expect(mark?.getAttribute("alt")).toBe("");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("src")).toContain("UkieBook-logo-exact.svg");
  });

  it("renders the S-17 field, privacy boundary, success and busy state accessibly", () => {
    render(
      <AuthorProfileScreen
        action="/author/profile"
        defaultValue="Соломія Гнатюк"
        fieldError="Укажіть публічне ім’я або псевдонім."
        saved
        saving
      />,
    );

    expect(screen.getByRole("heading", { name: "Профіль автора" })).toBeTruthy();
    const input = screen.getByLabelText(/Публічне ім’я або псевдонім/);
    expect(input.getAttribute("name")).toBe("publicName");
    expect(input.getAttribute("aria-describedby")).toBe(
      "author-public-name-description author-public-name-error",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Так це ім'я виглядатиме у книгарні")).toBeTruthy();
    expect(screen.getByText(/Договірні, платіжні й податкові дані зберігаються окремо/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Публічне ім’я збережено.");

    const submit = screen.getByRole("button", { name: "Зберегти" });
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a rejected profile mutation as a form error without invalidating the public-name field", () => {
    render(
      <AuthorProfileScreen
        action="/author/profile"
        defaultValue="Соломія Гнатюк"
        formError="Не вдалося перевірити запит. Оновіть сторінку й спробуйте ще раз."
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Не вдалося перевірити запит. Оновіть сторінку й спробуйте ще раз.",
    );
    expect(
      screen
        .getByLabelText(/Публічне ім’я або псевдонім/)
        .getAttribute("aria-invalid"),
    ).toBeNull();
  });
});
