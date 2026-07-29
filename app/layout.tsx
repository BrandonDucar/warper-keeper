import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const appUrl = "https://warper-keeper.dreamnet.ink";
const miniAppUrl = `${appUrl}/?miniApp=true`;
const miniAppEmbed = {
  version: "1",
  imageUrl: `${appUrl}/warper-social.png`,
  button: {
    title: "Open Warper Keeper",
    action: {
      type: "launch_miniapp",
      url: miniAppUrl,
      name: "Warper Keeper",
      splashImageUrl: `${appUrl}/warper-splash.png`,
      splashBackgroundColor: "#07100f",
    },
  },
};

const frameEmbed = {
  ...miniAppEmbed,
  button: {
    ...miniAppEmbed.button,
    action: {
      ...miniAppEmbed.button.action,
      type: "launch_frame",
    },
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Warper Keeper",
  description:
    "Catch notes, links, files, and public repositories. Send the exact context as a portable Trapper.",
  icons: {
    icon: "/warper-icon.png",
    shortcut: "/warper-icon.png",
  },
  openGraph: {
    title: "Warper Keeper",
    description:
      "Catch the good stuff. Wrap exact sources in a Trapper. Send it ready.",
    url: appUrl,
    siteName: "Warper Keeper",
    images: [{ url: "/warper-social.png", width: 1200, height: 800 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Warper Keeper",
    description: "Portable source bundles for people and agents.",
    images: ["/warper-social.png"],
  },
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(frameEmbed),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
