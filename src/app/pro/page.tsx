"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "courseforge_licence";

function ProInner() {
  const sessionId = useSearchParams().get("session_id") ?? "";
  const [licence, setLicence] = useState("");
  const [status, setStatus] = useState("Confirming your payment…");

  useEffect(() => {
    if (!sessionId) {
      setStatus("No checkout session found.");
      return;
    }
    let tries = 0;
    let stop = false;
    const poll = async () => {
      tries++;
      const res = await fetch(`/api/license?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json().catch(() => ({}));
      if (stop) return;
      if (res.status === 200 && data.licence) {
        try {
          localStorage.setItem(STORAGE_KEY, data.licence);
        } catch {}
        setLicence(data.licence);
        setStatus("Pro is unlocked on this browser.");
      } else if (res.status === 202 && tries < 20) {
        setStatus("Payment received - issuing your licence…");
        setTimeout(poll, 1500);
      } else {
        setStatus(
          data.error
            ? `We could not issue your licence (${data.error}). Email gptshivx@gmail.com with your receipt and we will fix it.`
            : "Still issuing your licence. Refresh this page in a minute, or email gptshivx@gmail.com with your receipt."
        );
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [sessionId]);

  return (
    <main className="max-w-xl mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold mb-4">CourseForge Pro</h1>
      <p className="mb-6">{status}</p>
      {licence && (
        <div className="card p-4">
          <p className="text-sm mb-2">Your licence key (keep it to unlock Pro on another browser):</p>
          <code className="block break-all text-xs p-2 rounded" style={{ background: "rgba(0,0,0,0.3)" }}>
            {licence}
          </code>
          <a href="/" className="btn-primary inline-block mt-4">
            Start outlining
          </a>
        </div>
      )}
    </main>
  );
}

export default function ProPage() {
  return (
    <Suspense fallback={<main className="max-w-xl mx-auto px-4 py-16">Loading…</main>}>
      <ProInner />
    </Suspense>
  );
}
