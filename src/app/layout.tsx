import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CourseForge — AI Course Outline Generator",
  description: "Turn your expertise into a structured online course in minutes. AI-powered course outline generator with module breakdown, lesson plans, and pricing strategy.",
  keywords: ["course outline generator", "online course creator", "AI course planner", "course structure", "course builder"],
  openGraph: { title: "CourseForge — AI Course Outline Generator", description: "Turn expertise into a structured course in minutes.", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-screen">{children}</body></html>;
}
