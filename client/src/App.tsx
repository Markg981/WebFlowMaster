import { Switch, Route } from "wouter";
import { useEffect, useState } from "react"; // Added useEffect and useState
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query"; // Added useQuery
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { DragDropProvider } from "@/components/drag-drop-provider";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import DashboardPage from "@/pages/dashboard-page-new";
import SettingsPage from "@/pages/settings-page";
import { ProtectedRoute } from "./lib/protected-route";
import { UserSettings, fetchSettings } from "./lib/settings"; // Import from shared file

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={DashboardPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { data: settingsData, isLoading: isLoadingSettings, isError: isErrorSettings } = useQuery<UserSettings, Error>({
    queryKey: ["userSettingsApp"], // Use a unique queryKey
    queryFn: fetchSettings,
    staleTime: Infinity, // Theme settings are unlikely to change frequently
  });

  useEffect(() => {
    if (settingsData) {
      if (settingsData.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [settingsData]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <DragDropProvider>
            <Toaster />
            <Router />
          </DragDropProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
