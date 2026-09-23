import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import AppShell from "@/components/layout/AppShell";

const MfaEnrollmentRequired = React.lazy(() => import("@/components/security/MfaEnrollmentRequired"));

export function ProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: React.ComponentType<any>;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  // Not the shell: every page in it would be refused by the server until this is done.
  if (user.mfaEnrollmentRequired) {
    return (
      <Route path={path}>
        <React.Suspense fallback={<PageLoading />}>
          <MfaEnrollmentRequired />
        </React.Suspense>
      </Route>
    );
  }

  return (
    <Route path={path}>
      <AppShell>
        {/* Pages load on first use (see App.tsx); the shell stays up while one does. */}
        <React.Suspense fallback={<PageLoading />}>
          <Component />
        </React.Suspense>
      </AppShell>
    </Route>
  );
}

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading page">
      <Loader2 className="h-8 w-8 animate-spin text-border" />
    </div>
  );
}
