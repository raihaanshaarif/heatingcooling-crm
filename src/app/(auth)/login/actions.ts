"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function loginAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const redirectTo = safeRedirect(String(formData.get("callbackUrl") ?? ""));
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          error.type === "CredentialsSignin"
            ? "Wrong email or password."
            : "Could not sign in. Try again.",
      };
    }
    throw error; // NEXT_REDIRECT must propagate
  }
}

/** Only allow same-site redirects. Auth.js passes absolute URLs, so keep just the path. */
function safeRedirect(callbackUrl: string): string {
  let path = callbackUrl;
  if (/^https?:\/\//.test(callbackUrl)) {
    try {
      const url = new URL(callbackUrl);
      path = `${url.pathname}${url.search}`;
    } catch {
      return "/";
    }
  }
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login") ? path : "/";
}
