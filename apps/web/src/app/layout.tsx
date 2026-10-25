import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Shippori_Mincho } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// The evolution page's type system (R-001): Hanken Grotesk for body text,
// JetBrains Mono for data, Shippori Mincho for titles and hero numbers.
const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

const data = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

const heading = Shippori_Mincho({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Beobeo",
  description: "Your financial companion — portfolio tracking done right.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${body.variable} ${data.variable} ${heading.variable} h-full antialiased`}
    >
      <head>
        {/* Apply .dark from the system preference before paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=window.matchMedia('(prefers-color-scheme: dark)');var s=function(){document.documentElement.classList.toggle('dark',m.matches)};s();m.addEventListener('change',s)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
