import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import { headers } from "next/headers"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { HaloToaster } from "@/components/ui/halo-toast"
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const spaceGrotesk = Space_Grotesk({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", spaceGrotesk.variable)}
    >
      <body>
        <ThemeProvider nonce={nonce}>
          {children}
          <HaloToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
