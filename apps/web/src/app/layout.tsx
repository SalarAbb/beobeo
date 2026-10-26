import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// One face for the whole app — logo, titles, text and numbers: Hanken Grotesk.
// The user asked for this explicitly; a serif for titles and a mono for numbers were
// both tried and removed as "a different font". Titles differ by size and weight only.
const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
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
      className={`${body.variable} h-full antialiased`}
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
