import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { PlayerProvider } from "@/context/PlayerContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ClientPlayerAndNav from "@/components/ClientPlayerAndNav";
import RemoteBridge from "@/components/RemoteBridge";
import ChromeTint from "@/components/ChromeTint";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.zenify.cc"),
  title: "Zenify - Cloud Music",
  description: "Your personal hi-res cloud music player",
  applicationName: "Zenify",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zenify",
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.png",
  },
  openGraph: {
    type: "website",
    siteName: "Zenify",
    url: "https://www.zenify.cc",
    title: "Zenify - Cloud Music",
    description: "Your personal hi-res cloud music player",
    images: [{ url: "/background.webp", width: 1920, height: 1039, alt: "Zenify" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zenify - Cloud Music",
    description: "Your personal hi-res cloud music player",
    images: ["/background.webp"],
  },
};

export const viewport: Viewport = {
  themeColor: "#2e3440",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The inline dark background on <html> makes the very first painted frame dark
  // — before external CSS (and its var(--bg-base)) loads — killing the white
  // flash on cold open / reload. Hardcoded to match --bg-base (dark theme).
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} h-full antialiased`}
      style={{ backgroundColor: "#2e3440" }}
    >
      <body className="min-h-full flex flex-col" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
        {/* Pre-paint lite-mode boot: decide data-perf BEFORE the first frame so a
            weak device never pays for one full-glass paint (all the backdrop-blur
            the lite CSS strips) and then flashes to lite once React hydrates.
            Mirrors ThemeContext's detectWeakDevice() + saved preference exactly;
            ThemeProvider re-affirms the same value on mount (idempotent). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('zenify-perf-mode')||'auto';var lite=false;if(m==='on'){lite=true;}else if(m==='auto'){var mem=navigator.deviceMemory,cores=navigator.hardwareConcurrency;if((mem&&mem<=4)||(cores&&cores<=4)){lite=true;}}if(lite){document.documentElement.setAttribute('data-perf','lite');}}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <ToastProvider>
            <PlayerProvider>
              <ServiceWorkerRegister />
              <RemoteBridge />
              <ChromeTint />
              {children}
              <ClientPlayerAndNav />
            </PlayerProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
