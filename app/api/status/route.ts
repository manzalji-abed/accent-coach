import { isMockMode } from "@/lib/ai/gemini";
import { json } from "@/lib/ai/guard";

export const dynamic = "force-dynamic";

/** Lets the UI show a "demo mode" note when no Gemini key is configured. */
export function GET() {
  return json({ mock: isMockMode() });
}
