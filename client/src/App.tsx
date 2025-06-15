import { Switch, Route } from "wouter";
// Removed useEffect, useState from here as App might not need them directly after refactor
// Kept queryClient and QueryClientProvider for App structure
// Removed useQuery from here as it's moved to ThemeLoader
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { DragDropProvider } from "@/components/drag-drop-provider";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import DashboardPage from "@/pages/dashboard-page-new";
import SettingsPage from "@/pages/settings-page";
import { ProtectedRoute } from "./lib/protected-route";
// Imports for ThemeLoader
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserSettings, fetchSettings } from './lib/settings';

const ThemeLoader = () => {
  const { data: settingsData } = useQuery<UserSettings, Error>({
    queryKey: ["userSettingsApp"],
    queryFn: fetchSettings,
    staleTime: Infinity,
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

  return null; // This component does not render anything
};

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
  // Theme loading logic is now in ThemeLoader
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <DragDropProvider>
            <ThemeLoader /> {/* Added ThemeLoader here */}
            <Toaster />
            <Router />
          </DragDropProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
