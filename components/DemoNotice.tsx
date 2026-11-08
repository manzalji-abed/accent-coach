"use client";
import { useEffect, useState } from "react";

/** Tells the user when the server has no Gemini key, so fake feedback isn't mistaken for real. */
export function DemoNotice() {
  const [mock, setMock] = useState(false);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setMock(Boolean(d.mock)))
      .catch(() => {});
  }, []);
  if (!mock) return null;
  return (
    <p className="notice" role="status" data-testid="demo-notice">
      Demo mode: feedback is sample data. Add a GEMINI_API_KEY on the server for real coaching.
    </p>
  );
}
