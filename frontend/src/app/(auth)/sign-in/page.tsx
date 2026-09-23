import { Suspense } from "react";
import { AuthView } from "@/features/auth/client";

export default function SignInPage() {
  return (
    <Suspense><AuthView mode="sign-in" /></Suspense>
  );
}
