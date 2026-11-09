/** The cast of conversation partners. Voice and personality are chosen server-side from this list only. */
export interface Persona {
  id: string;
  name: string;
  role: string;
  /** One line shown to the learner. */
  personality: string;
  /** Gemini Live prebuilt voice. */
  voice: string;
}

export const PERSONAS: Persona[] = [
  { id: "daniel", name: "Daniel Brooks", role: "CTO", personality: "Direct and technical", voice: "Charon" },
  { id: "maya", name: "Maya Chen", role: "CEO", personality: "Busy and big-picture", voice: "Kore" },
  { id: "omar", name: "Omar Haddad", role: "Hiring manager", personality: "Warm but probing", voice: "Puck" },
  { id: "sofia", name: "Sofia Martins", role: "Customer", personality: "Friendly but impatient", voice: "Aoede" },
  { id: "james", name: "James Walker", role: "Teammate", personality: "Casual", voice: "Fenrir" },
  { id: "leila", name: "Leila Rahman", role: "Product manager", personality: "Curious and organised", voice: "Leda" },
];

export const DEFAULT_PERSONA_ID = "james";

export function personaById(id: unknown): Persona | undefined {
  return typeof id === "string" ? PERSONAS.find((p) => p.id === id) : undefined;
}
