import React from 'react'; // Added React import
import { Switch, Route, useLocation } from "wouter"; // Added useLocation
// Kept queryClient and QueryClientProvider for App structure
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth"; // useAuth already imported here, good
import { DragDropProvider } from "@/components/drag-drop-provider";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import DashboardPage from "@/pages/dashboard-page-new"; // This is the "Create Test" page
import DashboardOverviewPage from "@/pages/DashboardOverviewPage";
import SettingsPage from "@/pages/settings-page";
import ApiTesterPage from "@/pages/ApiTesterPage"; // Import the new page
import { ProtectedRoute } from "./lib/protected-route";
// Imports for ThemeLoader
import { useEffect } from 'react'; // useEffect already imported
import { useQuery } from '@tanstack/react-query';
import { UserSettings, fetchSettings } from './lib/settings';
// useAuth is already imported via AuthProvider line above
import i18n from './i18n';

const SettingsEffectLoader = () => {
  const { user } = useAuth();
  const { data: settingsData } = useQuery<UserSettings, Error>({
    queryKey: ["userSettingsApp", user?.id],
    queryFn: fetchSettings,
    staleTime: Infinity,
    enabled: !!user,
  });

  useEffect(() => {
    if (settingsData) {
      if (settingsData.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      if (settingsData.language && i18n.language !== settingsData.language) {
        i18n.changeLanguage(settingsData.language).catch(err => {
            console.error("Error changing language in App.tsx:", err);
        });
      } else if (!settingsData.language && i18n.language !== 'en') {
        i18n.changeLanguage('en').catch(err => {
            console.error("Error changing language to fallback 'en' in App.tsx:", err);
        });
      }
    }
  }, [settingsData]);

  return null;
};

// Helper component for root path redirection
const RootRedirector = () => {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  React.useEffect(() => {
    if (!isLoading) {
      if (!user) {
        navigate("/auth", { replace: true });
      } else {
        // If user is logged in, redirect to the main dashboard overview.
        navigate("/dashboard", { replace: true });
      }
    }
  }, [user, isLoading, navigate]);

  return null; // This component doesn't render anything itself, it just redirects
};

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirector} /> {/* Handles root path redirection */}
      <ProtectedRoute path="/dashboard/create-test" component={DashboardPage} />
  <ProtectedRoute path="/dashboard/api-tester" component={ApiTesterPage} /> {/* Add new route */}
      <ProtectedRoute path="/dashboard" component={DashboardOverviewPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} /> {/* Catch-all for 404 */}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsEffectLoader />
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
