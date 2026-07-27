// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CartScreen,
  CheckoutResultScreen,
  type CartScreenModel,
  type CheckoutResultScreenModel,
  type CommerceBookItemViewModel,
} from "../../components/commerce";

const discountedBook: CommerceBookItemViewModel = {
  authorName: "Ірина Верес",
  bookId: "44444444-4444-4444-8444-444444444444",
  coverSrc: "/books/covers/final/sad-kamianykh-ptakhiv.png",
  discountLabel: "−16%",
  formattedActualPrice: "210 грн",
  formattedBasePrice: "250 грн",
  title: "Сад камʼяних птахів",
};

const regularBook: CommerceBookItemViewModel = {
  authorName: "Тарас Білик",
  bookId: "11111111-1111-4111-8111-111111111111",
  coverSrc: "/books/covers/final/khroniky-stepu.png",
  discountLabel: null,
  formattedActualPrice: "265 грн",
  formattedBasePrice: "265 грн",
  title: "Хроніки степу",
};

function cartModel(overrides: Partial<CartScreenModel> = {}): CartScreenModel {
  return {
    cartCount: 2,
    cartEditable: true,
    checkoutAllowed: true,
    formattedTotal: "475 грн",
    isAuthor: false,
    items: [discountedBook, regularBook],
    signedIn: false,
    ...overrides,
  };
}

function resultModel(
  overrides: Partial<CheckoutResultScreenModel> = {},
): CheckoutResultScreenModel {
  return {
    cartCount: 0,
    emailStatus: null,
    formattedTotal: "475 грн",
    isAuthor: false,
    items: [discountedBook, regularBook],
    signedIn: true,
    state: "pending",
    ...overrides,
  };
}

describe("UNIT-05 Aurora commerce presentation", () => {
  it("renders a constructive empty Cart with a current, empty header destination", () => {
    render(
      <CartScreen
        model={cartModel({
          cartCount: 0,
          cartEditable: true,
          checkoutAllowed: false,
          formattedTotal: "0 грн",
          items: [],
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Кошик" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Кошик порожній" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        current: "page",
        name: "Кошик, порожній",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "До каталогу" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByRole("link", { name: "Оплатити" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Оплатити" })).toBeNull();
  });

  it("renders a populated Guest Cart, canonical prices and auth return", () => {
    render(<CartScreen model={cartModel()} />);

    expect(
      screen.getByRole("link", { current: "page", name: "Кошик, 2 книжки" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Книжки" })).toBeVisible();
    expect(screen.getByText("−16%")).toBeVisible();
    expect(screen.getByText("250 грн")).toHaveProperty("tagName", "DEL");
    expect(screen.getByText("210 грн")).toBeVisible();
    expect(screen.getByText("475 грн")).toBeVisible();
    expect(
      screen.getByText("Для оплати увійдіть через Google або Facebook."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Оплатити" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fcart%3Fstep%3Dcheckout",
    );

    for (const book of [discountedBook, regularBook]) {
      const remove = screen.getByRole("button", {
        name: `Видалити «${book.title}» з кошика`,
      });
      const form = remove.closest("form");
      expect(form).not.toBeNull();
      expect(form).toHaveAttribute("action", "/api/cart/items/remove");
      expect(form).toHaveAttribute("method", "post");
      expect(form?.querySelector('input[name="bookId"]')).toHaveAttribute(
        "value",
        book.bookId,
      );
      expect(form?.querySelector('input[name="returnTo"]')).toHaveAttribute(
        "value",
        "/cart",
      );
    }
  });

  it("renders the authenticated checkout contract and preserves CSRF proof", () => {
    render(
      <CartScreen
        model={cartModel({
          csrfToken: "csrf-proof",
          signedIn: true,
        })}
      />,
    );

    const checkout = screen.getByRole("button", { name: "Оплатити" });
    const checkoutForm = checkout.closest("form");
    expect(checkoutForm).not.toBeNull();
    expect(checkoutForm).toHaveAttribute("action", "/api/checkout/start");
    expect(checkoutForm).toHaveAttribute("method", "post");
    expect(
      checkoutForm?.querySelector('input[name="csrfToken"]'),
    ).toHaveAttribute("value", "csrf-proof");
    expect(
      checkoutForm?.querySelector('input[name="returnTo"]'),
    ).toHaveAttribute("value", "/checkout/result");
    expect(
      screen.getByText(/UkieBook не зберігає дані картки/u),
    ).toBeVisible();

    const removeForms = screen
      .getAllByRole("button", { name: /Видалити/u })
      .map((button) => button.closest("form"));
    for (const form of removeForms) {
      expect(form?.querySelector('input[name="csrfToken"]')).toHaveAttribute(
        "value",
        "csrf-proof",
      );
    }
  });

  it("blocks a duplicate checkout while the existing payment is pending", () => {
    render(
      <CartScreen
        model={cartModel({
          cartEditable: false,
          checkoutAllowed: false,
          checkoutBlockReason:
            "Поточна оплата вже очікує підтвердження. Новий платіж тимчасово недоступний.",
          signedIn: true,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Оплатити" })).toBeDisabled();
    for (const remove of screen.getAllByRole("button", {
      name: /Видалити/u,
    })) {
      expect(remove).toBeDisabled();
    }
    expect(
      screen.getByText(/Поточна оплата вже очікує підтвердження/u),
    ).toBeVisible();
  });

  it("announces and focuses an inline Cart failure without hiding its recovery", () => {
    render(
      <CartScreen
        model={cartModel({
          errorMessage: "Не вдалося оновити кошик. Спробуйте ще раз.",
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Не вдалося оновити кошик");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("link", { name: "Продовжити покупки" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Оплатити" })).toBeVisible();
  });

  it("renders and announces the pending checkout result with an exact refresh URL", () => {
    render(
      <CheckoutResultScreen
        model={resultModel({
          refreshHref: "/checkout/result?payment=pending-proof",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Оплата підтверджується" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Очікуємо підтвердження від mono",
    );
    expect(screen.getByRole("heading", { name: "Книжки в замовленні" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Перевірити стан" })).toHaveAttribute(
      "href",
      "/checkout/result?payment=pending-proof",
    );
    expect(
      screen.getByRole("img", {
        name: "Сад камʼяних птахів, Ірина Верес",
      }),
    ).toBeVisible();
  });

  it("renders the success climax and distinguishes email delivery status", () => {
    const { rerender } = render(
      <CheckoutResultScreen
        model={resultModel({
          emailStatus: "sent",
          state: "success",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Дякуємо за покупку" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Підтвердження покупки надіслано на email",
    );
    expect(
      screen.getByRole("link", { name: "Перейти в бібліотеку" }),
    ).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "До каталогу" })).toHaveAttribute(
      "href",
      "/",
    );

    rerender(
      <CheckoutResultScreen
        model={resultModel({
          emailStatus: "failed",
          state: "success",
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Лист не вдалося надіслати, але оплату підтверджено",
    );
  });

  it("renders a focused failure with the preserved Cart and sanitized recovery", () => {
    render(
      <CheckoutResultScreen
        model={resultModel({
          cartCount: 2,
          failureMessage: "Банк не підтвердив оплату. Спробуйте ще раз.",
          state: "failure",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Оплату не підтверджено" }),
    ).toBeVisible();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Банк не підтвердив оплату");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Кошик збережено" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Повернутися в кошик" }),
    ).toHaveAttribute("href", "/cart");
    expect(
      within(screen.getByRole("main")).getByText("475 грн"),
    ).toBeVisible();
  });
});
