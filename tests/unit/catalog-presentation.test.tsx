// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CatalogScreen, PublicHeader } from "../../components/catalog";
import { catalogFixtureShell } from "../../modules/catalog/fixture-read-model";
import { normalizeCatalogQuery } from "../../modules/catalog/query";

describe("UNIT-02 Aurora catalog presentation", () => {
  it("keeps the exact S-01 copy and semantic locked sequence", () => {
    const model = catalogFixtureShell(normalizeCatalogQuery({}));
    render(
      <CatalogScreen
        model={{
          ...model,
          pagination: { ...model.pagination, totalItems: 1 },
          results: [model.featuredShelf[0]!],
        }}
        viewer={{ isAuthor: false, signedIn: false }}
      />,
    );

    expect(screen.getByRole("heading", { name: /Затишні вечори/u })).toBeTruthy();
    expect(
      screen.getByText("Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку."),
    ).toBeTruthy();
    expect(screen.getByText("Прозора формула: з кожних 100 грн")).toBeTruthy();
    expect(screen.getByRole("img", { name: "35 відсотків платформі, 65 відсотків автору" })).toBeTruthy();
    expect(screen.getByText("35%")).toBeTruthy();
    expect(screen.getByText("65% — автору")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Основна навігація" })).toBeTruthy();
    expect(screen.getAllByRole("search")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Кошик, 2 книжки" })).toBeTruthy();
    expect(screen.queryByText("🛒")).toBeNull();
    expect(screen.queryByText("⌕")).toBeNull();
    expect(screen.getAllByRole("link", { name: /Хроніки степу/u })[0]).toBeTruthy();
    expect(document.querySelector("[class*='coverCopy']")).toBeNull();
  });

  it("adds authenticated access without replacing baseline navigation", () => {
    render(<PublicHeader viewer={{ isAuthor: true, signedIn: true }} />);
    expect(screen.getAllByRole("link", { name: "Каталог" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Авторам" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Бібліотека" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Кабінет автора" })).toHaveLength(2);
  });

  it("marks Catalog current only on S-01 and preserves mobile search state", () => {
    const baselineModel = catalogFixtureShell(normalizeCatalogQuery({}));
    const filteredModel = catalogFixtureShell(
      normalizeCatalogQuery({ discounted: "1", genre: "proza", sort: "price_asc" }),
    );
    const { rerender } = render(
      <CatalogScreen model={baselineModel} viewer={{ isAuthor: false, signedIn: false }} />,
    );
    expect(screen.getAllByRole("link", { current: "page", name: "Каталог" })).toHaveLength(2);
    rerender(
      <CatalogScreen model={filteredModel} viewer={{ isAuthor: false, signedIn: false }} />,
    );
    expect(screen.getAllByRole("link", { current: "page", name: "Каталог" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { current: "location", name: "Жанри" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { current: "location", name: "Знижки" })).toHaveLength(2);
    const searches = screen.getAllByRole("search");
    expect(searches[1]!.querySelector('input[name="genre"]')?.getAttribute("value")).toBe(
      "proza",
    );
    expect(searches[1]!.querySelector('input[name="discounted"]')?.getAttribute("value")).toBe(
      "1",
    );
    expect(searches[1]!.querySelector('input[name="sort"]')?.getAttribute("value")).toBe(
      "price_asc",
    );

    rerender(<PublicHeader viewer={{ isAuthor: false, signedIn: false }} />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("renders the constructive empty and inline-error states", () => {
    const model = catalogFixtureShell(normalizeCatalogQuery({ q: "невідома" }));
    const { rerender } = render(
      <CatalogScreen model={model} viewer={{ isAuthor: false, signedIn: false }} />,
    );
    expect(screen.getByRole("heading", { name: "Нічого не знайдено" })).toBeTruthy();
    rerender(
      <CatalogScreen
        errorMessage="Повторіть спробу."
        model={model}
        viewer={{ isAuthor: false, signedIn: false }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Повторіть спробу");
  });
});
