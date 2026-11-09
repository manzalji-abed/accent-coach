import type { Goal, Mode } from "./types";

export interface Scenario {
  id: string;
  goal: Goal;
  mode: Exclude<Mode, "shadow">;
  title: string;
  /** The part the coach plays in this scene, without a name. Empty for free talk. */
  persona: string;
  /** Default conversation partner (see lib/personas.ts). */
  personaId: string;
  /** Preselected audience and goal (ids from lib/comms.ts) for communication practice. */
  audienceId?: string;
  intentId?: string;
  /** What the learner sees before starting */
  brief: string;
  /** The coach's first line */
  opener: string;
}

export const GOALS: { id: Goal; label: string; blurb: string }[] = [
  { id: "business", label: "Business & career", blurb: "Meetings, interviews, presentations" },
  { id: "travel", label: "Travel", blurb: "Airports, hotels, ordering food" },
  { id: "exams", label: "Exams", blurb: "IELTS and TOEFL speaking" },
  { id: "daily", label: "Everyday talk", blurb: "Small talk, hobbies, errands" },
];

export const SCENARIOS: Scenario[] = [
  // Free talk, one per goal
  { id: "free-business", goal: "business", mode: "talk", title: "Talk about your work", persona: "", personaId: "omar", brief: "Chat about your job, your team, or a project.", opener: "Hi! Tell me a bit about what you do for work." },
  { id: "free-travel", goal: "travel", mode: "talk", title: "Talk about a trip", persona: "", personaId: "sofia", brief: "A past trip, or one you're planning.", opener: "Hey! Where's the last place you travelled to?" },
  { id: "free-exams", goal: "exams", mode: "talk", title: "Exam warm-up", persona: "", personaId: "omar", brief: "Part 1 style questions about you and your life.", opener: "Let's warm up. Can you describe the town where you grew up?" },
  { id: "free-daily", goal: "daily", mode: "talk", title: "Open chat", persona: "", personaId: "james", brief: "Anything you like: your day, hobbies, plans.", opener: "Hi there! How has your day been so far?" },

  // Role-plays
  { id: "rp-interview", goal: "business", mode: "roleplay", title: "Job interview", persona: "a hiring manager who asks sharp follow-up questions", personaId: "omar", brief: "You're interviewing for a role you want.", opener: "Thanks for coming in. Let's start simple: walk me through your background." },
  { id: "rp-salary", goal: "business", mode: "roleplay", title: "Salary negotiation", persona: "a direct manager with a tight budget", personaId: "daniel", brief: "You want a raise. Make your case.", opener: "You wanted to talk about compensation. I'm listening." },
  { id: "rp-outage", goal: "business", mode: "roleplay", title: "Explain an outage to your CEO in 60 seconds", persona: "a busy CEO who has one minute and wants the bottom line", personaId: "maya", audienceId: "ceo", intentId: "explain-problem", brief: "Something broke in production. Say what happened, the impact and what you need, in about a minute.", opener: "I've got one minute before my next meeting. What's going on with the outage?" },
  { id: "rp-raise", goal: "business", mode: "roleplay", title: "Ask your manager for a raise", persona: "a fair manager who wants evidence", personaId: "daniel", audienceId: "manager", intentId: "ask", brief: "Ask clearly for a raise and back it up with your results.", opener: "You asked for time to talk. What's on your mind?" },
  { id: "rp-deadline", goal: "business", mode: "roleplay", title: "Push back on a deadline with your CTO", persona: "a CTO who wants a date and hates vague answers", personaId: "daniel", audienceId: "cto", intentId: "push-back", brief: "The deadline is unrealistic. Explain the risk and offer options.", opener: "I need this shipped by the end of the month. Is there any problem with that?" },
  { id: "rp-delay", goal: "business", mode: "roleplay", title: "Tell a customer their order is delayed", persona: "a customer who is annoyed about a late order", personaId: "sofia", audienceId: "customer", intentId: "bad-news", brief: "Deliver the bad news with empathy and a clear next step.", opener: "Hi, I was told my order would be here by now. What's happening?" },
  { id: "rp-meeting", goal: "business", mode: "roleplay", title: "Status meeting", persona: "a project lead who wants clear updates", personaId: "leila", brief: "Give a project update and handle questions.", opener: "Morning! Can you give us a quick update on where things stand?" },
  { id: "rp-customs", goal: "travel", mode: "roleplay", title: "Customs officer", persona: "a by-the-book border officer", personaId: "daniel", brief: "Get through customs at the airport.", opener: "Passport, please. What's the purpose of your visit?" },
  { id: "rp-hotel", goal: "travel", mode: "roleplay", title: "Hotel check-in", persona: "a friendly front-desk clerk", personaId: "sofia", brief: "Check in and sort out a problem with your booking.", opener: "Good evening, welcome! Checking in?" },
  { id: "rp-restaurant", goal: "travel", mode: "roleplay", title: "Ordering dinner", persona: "a busy waiter", personaId: "james", brief: "Order a meal and ask about the menu.", opener: "Hi folks, can I start you off with something to drink?" },
  { id: "rp-ielts", goal: "exams", mode: "roleplay", title: "IELTS speaking, part 2", persona: "a calm, neutral IELTS examiner", personaId: "maya", brief: "Speak for up to two minutes on a topic.", opener: "Describe a skill you learned that took a long time. You can start whenever you're ready." },
  { id: "rp-debate", goal: "exams", mode: "roleplay", title: "Academic debate", persona: "a professor who pushes back on weak arguments", personaId: "daniel", brief: "Defend a position and respond to challenges.", opener: "Some argue remote learning is as effective as the classroom. Where do you stand?" },
  { id: "rp-barista", goal: "daily", mode: "roleplay", title: "Coffee order", persona: "a chatty barista", personaId: "james", brief: "Order your usual and make small talk.", opener: "Hey! What can I get started for you today?" },
  { id: "rp-neighbor", goal: "daily", mode: "roleplay", title: "New neighbor", persona: "a friendly neighbor who just moved in", personaId: "leila", brief: "Introduce yourself and chat.", opener: "Oh hi! I just moved in next door. Nice to meet you!" },
  { id: "rp-doctor", goal: "daily", mode: "roleplay", title: "Doctor's appointment", persona: "a patient family doctor", personaId: "omar", brief: "Describe how you've been feeling.", opener: "Come on in. So, what brings you in today?" },
];

export const SHADOW_SENTENCES: Record<Goal, string[]> = {
  business: [
    "I'd like to walk you through the quarterly results.",
    "Could we schedule a follow-up for Thursday afternoon?",
    "I think there's a better way to approach this problem.",
    "Our team delivered the project three weeks ahead of schedule.",
    "Let's circle back once we have the final numbers.",
  ],
  travel: [
    "Excuse me, which way is the baggage claim?",
    "I have a reservation under the name Thompson.",
    "Could I get the check, please?",
    "Is there a pharmacy near the hotel?",
    "I'd like a window seat if there's one available.",
  ],
  exams: [
    "In my opinion, the advantages clearly outweigh the disadvantages.",
    "There are three main reasons why I think this is true.",
    "Throughout my childhood, I was fascinated by mathematics.",
    "On the other hand, technology can isolate people.",
    "This is particularly important for developing countries.",
  ],
  daily: [
    "I'd love a medium latte with oat milk, please.",
    "The weather's been really strange this month.",
    "We're thinking about going to the beach this weekend.",
    "Thanks so much, I really appreciate it.",
    "Three of my friends are coming over on Thursday.",
  ],
};

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** A stable "lesson of the day" so the home screen changes daily without any AI call. */
export function lessonForDay(goal: Goal, date: Date): Scenario {
  const pool = SCENARIOS.filter((s) => s.goal === goal && s.mode === "roleplay");
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return pool[day % pool.length];
}
