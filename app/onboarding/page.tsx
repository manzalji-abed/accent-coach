"use client";
import { useRouter } from "next/navigation";
import { ProfileForm } from "@/components/ProfileForm";
import { saveProfile } from "@/lib/store";

export default function Onboarding() {
  const router = useRouter();
  return (
    <main className="page">
      <h1 className="page-title">Sound the way you mean to.</h1>
      <p className="lede">Talk with your coach. It hears which sounds slip and shows you how to fix them.</p>
      <ProfileForm
        stepped
        submitLabel="Start practising"
        onSubmit={(p) => {
          saveProfile(p);
          router.replace("/");
        }}
      />
    </main>
  );
}
