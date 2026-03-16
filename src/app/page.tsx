"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const token = useAuth((s) => s.token);

  useEffect(() => {
    if (token) {
      router.replace("/games");
    } else {
      router.replace("/login");
    }
  }, [token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800">
      <div className="flex flex-col items-center gap-3">
        <div className="text-4xl animate-pulse">🃏</div>
        <p className="text-zinc-400 text-sm">正在加载...</p>
      </div>
    </div>
  );
}
