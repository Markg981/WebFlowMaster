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
import { useAuth } from './hooks/use-auth'; // Import useAuth

const ThemeLoader = () => {
  const { user } = useAuth(); // Call useAuth
  const { data: settingsData } = useQuery<UserSettings, Error>({
    queryKey: ["userSettingsApp", user?.id], // Add user?.id to queryKey
    queryFn: fetchSettings,
    staleTime: Infinity,
    enabled: !!user, // Only fetch if user is authenticated
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
        <ThemeLoader /> {/* Moved ThemeLoader to be a direct child of AuthProvider */}
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
