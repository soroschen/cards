"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

const AVATARS = ["🃏", "🎴", "♠️", "♥️", "♦️", "♣️", "🀄", "🎲"];

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);

  // Login state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regAvatar, setRegAvatar] = useState("🃏");
  const [regLoading, setRegLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) {
      toast.error("请填写用户名和密码");
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "登录失败");
        return;
      }
      login(data.user, data.token);
      toast.success(`欢迎回来，${data.user.username}！`);
      router.replace("/games");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!regUsername.trim() || !regPassword.trim()) {
      toast.error("请填写用户名和密码");
      return;
    }
    if (regPassword.length < 4) {
      toast.error("密码至少 4 位");
      return;
    }
    setRegLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: regUsername.trim(), password: regPassword, avatar: regAvatar }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "注册失败");
        return;
      }
      login(data.user, data.token);
      toast.success(`注册成功，欢迎 ${data.user.username}！`);
      router.replace("/games");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3 drop-shadow-lg">🃏</div>
          <h1 className="text-3xl font-bold text-white tracking-tight">升级计分</h1>
          <p className="text-zinc-400 text-sm mt-1.5">记录每一局，见证每一升</p>
        </div>

        <Card className="bg-zinc-900/80 backdrop-blur-sm ring-1 ring-white/10 shadow-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-center text-white text-lg">欢迎使用</CardTitle>
            <CardDescription className="text-center text-zinc-400">
              登录或注册账号开始游戏
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Tabs defaultValue="login">
              <TabsList className="w-full mb-6 bg-zinc-800">
                <TabsTrigger value="login" className="flex-1 data-active:bg-emerald-600 data-active:text-white">
                  登录
                </TabsTrigger>
                <TabsTrigger value="register" className="flex-1 data-active:bg-emerald-600 data-active:text-white">
                  注册
                </TabsTrigger>
              </TabsList>

              {/* Login Tab */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-username" className="text-zinc-300 text-sm">
                      用户名
                    </Label>
                    <Input
                      id="login-username"
                      type="text"
                      placeholder="请输入用户名"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 h-10"
                      autoComplete="username"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-password" className="text-zinc-300 text-sm">
                      密码
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="请输入密码"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 h-10"
                      autoComplete="current-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold mt-1 disabled:opacity-60"
                  >
                    {loginLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        登录中...
                      </span>
                    ) : (
                      "登录"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Register Tab */}
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-username" className="text-zinc-300 text-sm">
                      用户名
                    </Label>
                    <Input
                      id="reg-username"
                      type="text"
                      placeholder="请输入用户名"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 h-10"
                      autoComplete="username"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-password" className="text-zinc-300 text-sm">
                      密码
                    </Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="至少 4 位密码"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 h-10"
                      autoComplete="new-password"
                    />
                  </div>

                  {/* Avatar Picker */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-zinc-300 text-sm">选择头像</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {AVATARS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setRegAvatar(emoji)}
                          className={`
                            flex items-center justify-center h-12 rounded-lg text-2xl transition-all
                            ${regAvatar === emoji
                              ? "bg-emerald-600/30 ring-2 ring-emerald-500 scale-105"
                              : "bg-zinc-800 hover:bg-zinc-700 ring-1 ring-zinc-700"
                            }
                          `}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={regLoading}
                    className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold mt-1 disabled:opacity-60"
                  >
                    {regLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        注册中...
                      </span>
                    ) : (
                      "注册"
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
