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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) nav({ to: "/dashboard", replace: true });
    });
  }, [nav]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    nav({ to: "/dashboard", replace: true });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullName = name.trim();
    if (!fullName) return toast.error("Name is required.");

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    setLoading(false);

    if (error) return toast.error(error.message);

    if (data.session) {
      toast.success("Account created");
      nav({ to: "/dashboard", replace: true });
      return;
    }

    toast.success("Account created. You can sign in after confirming your email.");
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
          <p className="text-xs text-muted-foreground text-center pt-4">
            {isSignUp
              ? "New accounts start as viewer. An admin can grant more access later."
              : "New team member?"}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full"
            onClick={() => setMode(isSignUp ? "signin" : "signup")}
            disabled={loading}
          >
            {isSignUp ? "Back to sign in" : "Create an account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
