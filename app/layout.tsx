import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ?? requestHeaders.get("host");
  const configuredBase = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.openbucket.dev");
  let protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : configuredBase.protocol.replace(":", "");
  if (!forwardedProto && host) {
    try {
      const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
      if (["localhost", "127.0.0.1", "::1"].includes(hostname)) protocol = "http";
    } catch { /* keep the configured protocol */ }
  }
  let metadataBase = configuredBase;
  if (host) {
    try { metadataBase = new URL(`${protocol}://${host}`); } catch { /* keep the configured origin */ }
  }
  const socialImage = new URL("/og.png", metadataBase).toString();
  return {
    metadataBase,
    title: { default: "OpenBucket — your disk, now S3-compatible", template: "%s · OpenBucket" },
    description: "Turn any local folder, disk, SSD, or NAS into secure S3-compatible object storage with one daemon and one CLI.",
    applicationName: "OpenBucket",
    alternates: { canonical: metadataBase },
    openGraph: {
      type: "website",
      title: "OpenBucket — your disk, now S3-compatible",
      description: "Operate local storage through a cloud-grade S3 API and dashboard.",
      siteName: "OpenBucket",
      url: metadataBase,
      images: [{ url: socialImage, width: 1731, height: 909, alt: "OpenBucket connects local storage to an S3 API and dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "OpenBucket — your disk, now S3-compatible",
      description: "Operate local storage through a cloud-grade S3 API and dashboard.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
