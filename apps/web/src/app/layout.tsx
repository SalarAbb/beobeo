import type { Metadata } from "next";
import { Hanken_Grotesk, Shippori_Mincho } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// One face for everything you read, words and numbers alike: Hanken Grotesk.
// Shippori Mincho only for page and section titles. (A mono face for numbers was
// tried and removed: the user saw it as "a different font" mixed into the pages.)
const body = Hanken_Grotesk({
  variable: "--font-body",
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
      className={`${body.variable} ${heading.variable} h-full antialiased`}
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
