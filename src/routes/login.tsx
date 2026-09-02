import { useEffect, useState } from "react";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { AuthScreen, emailSignIn, emailSignUp } from "@/components/auth-screen";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getBootstrapState } from "@/lib/server/budget";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [signup, setSignup] = useState(false);

  useEffect(() => {
    void getBootstrapState()
      .then((s) => {
        if (s.needsSetup) void navigate({ to: "/setup" });
      })
      .catch(() => {
        /* stay on sign-in if bootstrap cannot run */
      });
  }, [navigate]);

  if (!isPending && user) return <Navigate to="/" />;

  return (
    <AuthScreen
      mode={signup ? "signup" : "signin"}
      title={signup ? "Create account" : "Sign in"}
      subtitle={
        signup
          ? "Your money stays on your account. Nobody else can see it."
          : "Email and password. Your ledger is private to you."
      }
      onEmail={async ({ name, email, password }) => {
        if (signup) await emailSignUp(name, email, password);
        else await emailSignIn(email, password);
        await navigate({ to: "/" });
      }}
      footer={
        signup ? (
          <p>
            Already have an account?{" "}
            <button type="button" className="text-fg underline" onClick={() => setSignup(false)}>
              Sign in
            </button>
          </p>
        ) : (
          <p>
            New here?{" "}
            <button type="button" className="text-fg underline" onClick={() => setSignup(true)}>
              Create an account
            </button>
            {" · "}
            <Link to="/setup" className="text-fg underline">
              First-time setup
            </Link>
          </p>
        )
      }
    />
  );
}