"use client";

import { useState } from "react";

const LEVELS = ["Complete Beginner", "Beginner to Intermediate", "Intermediate", "Intermediate to Advanced", "Advanced"];
const DURATIONS = ["2-3 weeks (Mini Course)", "4-6 weeks", "6-8 weeks", "8-12 weeks (Comprehensive)", "12+ weeks (Masterclass)"];
const FORMATS = ["Self-paced video course", "Cohort-based live course", "Text-based course", "Hybrid (video + live sessions)", "Workshop series"];

export default function Home() {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [level, setLevel] = useState("Beginner to Intermediate");
  const [duration, setDuration] = useState("6-8 weeks");
  const [format, setFormat] = useState("Self-paced video course");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!topic) return;
    setLoading(true); setError(""); setResult("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, audience, level, duration, format }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error); return; }
      setResult(data.outline);
      setRemaining(data.remaining);
    } catch { setError("Something went wrong."); }
    finally { setLoading(false); }
  }

  function copyAll() {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadMd() {
    const blob = new Blob([result], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `course-outline-${topic.replace(/\s+/g, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen">
      <section className="max-w-4xl mx-auto px-4 pt-16 pb-8 text-center">
        <div className="inline-block mb-4 px-4 py-1.5 rounded-full text-sm"
          style={{ background: "rgba(217,119,6,0.15)", color: "#fbbf24", border: "1px solid rgba(217,119,6,0.3)" }}>
          Free — No signup required
        </div>
        <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
          Turn Your Expertise Into a<br />
          <span className="gradient-text">Structured Course</span>
        </h1>
        <p className="text-lg md:text-xl mb-8" style={{ color: "var(--muted)" }}>
          AI-powered course outline generator. Get a complete module breakdown,<br />
          lesson plans, and pricing strategy in seconds.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 pb-8">
        <div className="card p-6 md:p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>What will you teach? *</label>
            <input type="text" placeholder="e.g., Python for Data Science, Instagram Marketing for Small Businesses" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Target Audience</label>
            <input type="text" placeholder="e.g., Marketing managers, college students, small business owners" value={audience} onChange={(e) => setAudience(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Level</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Duration</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <button onClick={handleGenerate} disabled={loading || !topic} className="btn-primary w-full text-center text-lg">
            {loading ? <span>Generating outline<span className="loading-dots"></span></span> : "Generate Course Outline"}
          </button>
          {remaining !== null && (
            <p className="text-center text-sm" style={{ color: "var(--muted)" }}>{remaining} free generation{remaining !== 1 ? "s" : ""} remaining today</p>
          )}
        </div>
      </section>

      {error && (
        <section className="max-w-2xl mx-auto px-4 pb-4">
          <div className="rounded-lg p-4" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <p className="text-red-400">{error}</p>
          </div>
        </section>
      )}

      {result && (
        <section className="max-w-3xl mx-auto px-4 pb-12 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Your Course Outline</h2>
            <div className="flex gap-2">
              <button onClick={copyAll} className="copy-btn">{copied ? "Copied!" : "Copy All"}</button>
              <button onClick={downloadMd} className="copy-btn" style={{ background: "#374151" }}>Download .md</button>
            </div>
          </div>
          <div className="module-card">
            <div className="prose prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">{result}</div>
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Why <span className="gradient-text">CourseForge</span>?</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { title: "Expert-Level Structure", desc: "Outlines follow proven instructional design principles. Each module builds logically on the last.", icon: "📐" },
            { title: "Complete & Actionable", desc: "Get module breakdowns, lesson plans, projects, pricing strategy, and bonus ideas — all at once.", icon: "📋" },
            { title: "Export & Build", desc: "Download as Markdown, copy to your course platform, and start creating content immediately.", icon: "🚀" },
          ].map((f) => (
            <div key={f.title} className="card p-6 text-center">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-4">Simple Pricing</h2>
        <p className="text-center mb-12" style={{ color: "var(--muted)" }}>Start free. Upgrade when you need more.</p>
        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="card p-6">
            <h3 className="font-semibold text-lg mb-1">Free</h3>
            <p className="text-3xl font-bold mb-4">$0</p>
            <ul className="space-y-2 text-sm mb-6" style={{ color: "var(--muted)" }}>
              <li>&#10003; 3 outlines/day</li><li>&#10003; All course formats</li><li>&#10003; Markdown export</li>
            </ul>
            <button className="w-full py-2 rounded-lg font-medium" style={{ border: "1px solid var(--border)", color: "var(--muted)" }}>Current Plan</button>
          </div>
          <div className="card p-6" style={{ border: "1px solid rgba(245,158,11,0.5)" }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-lg">Pro</h3>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.3)", color: "#fbbf24" }}>Best Value</span>
            </div>
            <p className="text-3xl font-bold mb-4">$19<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/mo</span></p>
            <ul className="space-y-2 text-sm mb-6" style={{ color: "var(--muted)" }}>
              <li>&#10003; Unlimited outlines</li><li>&#10003; Curriculum advisor chat</li><li>&#10003; Slide deck generation</li>
              <li>&#10003; Student worksheet templates</li><li>&#10003; Market research report</li>
            </ul>
            <a href="#" className="btn-primary block w-full text-center">Get Pro</a>
          </div>
        </div>
      </section>

      <footer className="max-w-4xl mx-auto px-4 py-8 text-center text-sm" style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
        <p>CourseForge &mdash; AI-powered course outline generator for creators and educators.</p>
      </footer>
    </main>
  );
}
