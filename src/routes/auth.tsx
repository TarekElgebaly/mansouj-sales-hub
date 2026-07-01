import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Mansouj" }] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) nav({ to: "/dashboard", replace: true });
    });
  }, [nav]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      setMessage({ type: "error", text: error.message });
      return toast.error(error.message);
    }
    toast.success("Signed in");
    nav({ to: "/dashboard", replace: true });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const fullName = name.trim();
    const cleanEmail = email.trim();
    if (!fullName) return toast.error("Name is required.");
    if (!cleanEmail) return toast.error("Email is required.");

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) {
      setLoading(false);
      setMessage({ type: "error", text: error.message });
      return toast.error(error.message);
    }

    if (!data.user?.id) {
      const text = "Signup did not return a Supabase Auth user.";
      setLoading(false);
      setMessage({ type: "error", text });
      return toast.error(text);
    }

    const ensureRes = await fetch("/api/auth/ensure-signup-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: data.user.id,
        full_name: fullName,
        email: cleanEmail,
      }),
    });
    const ensureJson = await ensureRes.json().catch(() => ({}));
    setLoading(false);

    if (!ensureRes.ok || !ensureJson.ok) {
      const text = ensureJson.error ?? "Account was created, but profile/role setup failed.";
      setMessage({ type: "error", text });
      return toast.error(text);
    }

    if (data.session) {
      const text = "Account created. You can sign in now.";
      setMessage({ type: "success", text });
      toast.success(text);
      nav({ to: "/dashboard", replace: true });
      return;
    }

    const text = "Account created. Please check your email to confirm your account.";
    setMessage({ type: "success", text });
    toast.success(text);
    setMode("signin");
  };

  const isSignUp = mode === "signup";

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 h-10 w-10 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">M</div>
          <CardTitle>Mansouj Sales</CardTitle>
          <CardDescription>{isSignUp ? "Create your team account" : "Internal operations dashboard"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={isSignUp ? signUp : signIn} className="space-y-3 pt-2">
            {isSignUp && (
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (isSignUp ? "Creating account…" : "Signing in…") : (isSignUp ? "Sign up" : "Sign in")}
            </Button>
          </form>
          {message && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                message.type === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
              }`}
            >
              {message.text}
            </div>
          )}
          <p className="text-xs text-muted-foreground text-center pt-4">
            {isSignUp
              ? "New accounts start as viewer. An admin can grant more access later."
              : "New team member?"}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full"
            onClick={() => {
              setMessage(null);
              setMode(isSignUp ? "signin" : "signup");
            }}
            disabled={loading}
          >
            {isSignUp ? "Back to sign in" : "Create an account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
