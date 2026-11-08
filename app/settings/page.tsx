"use client";
import { useState } from "react";
import { ProfileForm } from "@/components/ProfileForm";
import { TabBar } from "@/components/TabBar";
import { useProfileGate } from "@/components/useProfileGate";
import { dailyReminderIcs } from "@/lib/ics";
import { resetAll, saveProfile } from "@/lib/store";

export default function SettingsPage() {
  const app = useProfileGate();
  const [saved, setSaved] = useState(false);
  if (!app) return null;

  const downloadReminder = () => {
    const ics = dailyReminderIcs({ time: app.profile!.reminderTime, title: "Accent practice (10 min)", url: window.location.origin });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "accent-practice.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <main className="page">
        <h1 className="page-title">Settings</h1>

        <h2 className="section-title">Daily reminder</h2>
        <p className="lede" style={{ marginBottom: 12 }}>
          Adds a repeating event to your phone&apos;s calendar at your practice time, with an alert.
        </p>
        <button type="button" className="btn btn-quiet btn-block" onClick={downloadReminder} data-testid="add-reminder">
          Add reminder to calendar
        </button>

        <ProfileForm
          initial={app.profile}
          stepped={false}
          submitLabel={saved ? "Saved" : "Save changes"}
          onSubmit={(p) => {
            saveProfile(p);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        />

        <h2 className="section-title">Your data</h2>
        <p className="lede" style={{ marginBottom: 12 }}>
          Everything is stored on this device only. Recordings are never saved.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => {
            if (confirm("Erase all progress, history and settings on this device? This can't be undone.")) resetAll();
          }}
        >
          Erase all data
        </button>
      </main>
      <TabBar />
    </>
  );
}
