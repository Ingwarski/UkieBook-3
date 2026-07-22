import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/golos-text/wght.css";
import "@fontsource-variable/literata/wght.css";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "UkieBook",
    template: "%s · UkieBook",
  },
  description: "Українська платформа електронних книжок.",
  icons: {
    icon: "/brand/UkieBook-logo-transparent.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFF7F3",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
