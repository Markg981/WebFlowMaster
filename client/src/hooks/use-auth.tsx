import { createContext, ReactNode, useContext, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/** The user as /api/user describes it: the row without its password, plus the second factor. */
export type SessionUser = Omit<SelectUser, "password"> & {
  mfaEnabled?: boolean;
  /** The organization requires a second factor and this user has none: nothing else works until they do. */
  mfaEnrollmentRequired?: boolean;
  /** Whether installation-wide settings (log level, runners) are this person's to change. */
  installationAdmin?: boolean;
  /** This session was opened through the organization's identity provider (server/sso.ts). */
  signedInWithSso?: boolean;
};

type AuthContextType = {
  user: SessionUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SessionUser | { mfaRequired: true }, Error, LoginData>;
  /** The password was right and a code is owed: the sign-in page asks for it. */
  mfaChallenge: boolean;
  verifyMfaMutation: UseMutationResult<SessionUser, MfaError, string>;
  cancelMfaChallenge: () => void;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SessionUser, Error, InsertUser>;
};

type LoginData = Pick<InsertUser, "username" | "password">;

/** A refused code, with the server's reason: a wrong code, or an attempt that has ended. */
export class MfaError extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

export const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [mfaChallenge, setMfaChallenge] = useState(false);
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SessionUser | undefined, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return (await res.json()) as SessionUser | { mfaRequired: true };
    },
    onSuccess: (result) => {
      if ("mfaRequired" in result) {
        setMfaChallenge(true);
        return;
      }
      queryClient.setQueryData(["/api/user"], result);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const verifyMfaMutation = useMutation<SessionUser, MfaError, string>({
    mutationFn: async (code: string) => {
      // Not apiRequest: a refusal here carries a code the page acts on (try again, or start over).
      const res = await fetch("/api/login/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new MfaError(body.message ?? "That code is not valid.", body.code);
      return body as SessionUser;
    },
    onSuccess: (signedIn) => {
      setMfaChallenge(false);
      queryClient.setQueryData(["/api/user"], signedIn);
    },
    onError: (mfaError) => {
      if (mfaError.code === "mfa_challenge_expired") setMfaChallenge(false);
    },
  });

  const registerMutation = useMutation({
    // With an invitation's token the account joins the inviting organization (see server/auth.ts).
    mutationFn: async (credentials: InsertUser & { invitationToken?: string }) => {
      const res = await apiRequest("POST", "/api/register", credentials);
      return await res.json();
    },
    onSuccess: (registered: SessionUser) => {
      queryClient.setQueryData(["/api/user"], registered);
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        mfaChallenge,
        verifyMfaMutation,
        cancelMfaChallenge: () => setMfaChallenge(false),
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
