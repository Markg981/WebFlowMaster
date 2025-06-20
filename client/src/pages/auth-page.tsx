import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, TestTube } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, navigate] = useLocation();
  
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({ username: "", password: "", confirmPassword: "" });

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate("/dashboard"); // Changed navigation target
    }
  }, [user, navigate]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginData);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (registerData.password !== registerData.confirmPassword) {
      return;
    }
    registerMutation.mutate({ 
      username: registerData.username, 
      password: registerData.password 
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex"> {/* Changed gradient to bg-background */}
      {/* Left side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-full mb-4">
              <TestTube className="h-8 w-8 text-primary-foreground" /> {/* Changed text-white to text-primary-foreground */}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t('authPage.webtestPlatform.text')}</h1> {/* Changed text-gray-900 to text-foreground */}
            <p className="text-muted-foreground mt-2">{t('authPage.automatedWebTestingMadeSimple.text')}</p> {/* Changed text-gray-600 to text-muted-foreground */}
          </div>

          <Card> {/* Card component from ui/ is already theme-aware */}
            <CardHeader> {/* Card components from ui/ are already theme-aware */}
              <CardTitle>{t('authPage.welcome.title')}</CardTitle>
              <CardDescription>
                {t('authPage.signInToYourAccountOrCreate.description')}
              </CardDescription>
            </CardHeader>
            <CardContent> {/* Card components from ui/ are already theme-aware */}
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">{t('authPage.signIn.button')}</TabsTrigger>
                  <TabsTrigger value="register">{t('authPage.register.button')}</TabsTrigger>
                </TabsList>
                
                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-username">{t('authPage.username.label')}</Label>
                      <Input
                        id="login-username"
                        type="text"
                        placeholder={t('authPage.enterYourUsername.placeholder')}
                        value={loginData.username}
                        onChange={(e) => setLoginData({ ...loginData, username: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">{t('authPage.password.label')}</Label>
                      <Input
                        id="login-password"
                        type="password"
                        placeholder={t('authPage.enterYourPassword.placeholder')}
                        value={loginData.password}
                        onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                        required
                      />
                    </div>
                    {loginMutation.error && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {loginMutation.error.message}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={loginMutation.isPending}
                    >
                      {loginMutation.isPending ? t('authPage.signingIn.button') : t('authPage.signIn.button')}
                    </Button>
                  </form>
                </TabsContent>
                
                <TabsContent value="register">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-username">{t('authPage.username.label')}</Label>
                      <Input
                        id="register-username"
                        type="text"
                        placeholder={t('authPage.chooseAUsername.placeholder')}
                        value={registerData.username}
                        onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-password">{t('authPage.password.label')}</Label>
                      <Input
                        id="register-password"
                        type="password"
                        placeholder={t('authPage.chooseAPassword.placeholder')}
                        value={registerData.password}
                        onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">{t('authPage.confirmPassword.label')}</Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        placeholder={t('authPage.confirmYourPassword.placeholder')}
                        value={registerData.confirmPassword}
                        onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                        required
                      />
                    </div>
                    {registerData.password !== registerData.confirmPassword && registerData.confirmPassword && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {t('authPage.passwordsDoNotMatch.description')}
                        </AlertDescription>
                      </Alert>
                    )}
                    {registerMutation.error && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {registerMutation.error.message}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={registerMutation.isPending || registerData.password !== registerData.confirmPassword}
                    >
                      {registerMutation.isPending ? t('authPage.creatingAccount.button') : t('authPage.createAccount.button')}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right side - Hero section */}
      {/* This section uses primary color for background, so text should be primary-foreground for contrast */}
      <div className="flex-1 bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center p-8 text-primary-foreground">
        <div className="max-w-md text-center">
          <TestTube className="h-20 w-20 mx-auto mb-6 opacity-90" /> {/* Icon color will be inherited (primary-foreground) */}
          <h2 className="text-3xl font-bold mb-4">{t('authPage.automateYourWebTesting.title')}</h2>
          <p className="text-lg opacity-90 mb-6">
            {t('authPage.createExecuteAndManageAutomated.description')}{' '}
            {t('authPage.noCodingRequired.text')}
          </p>
          <div className="space-y-3 text-left">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-primary-foreground rounded-full"></div> {/* Changed bg-white to bg-primary-foreground */}
              <span>{t('authPage.visualElementDetection.text')}</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-primary-foreground rounded-full"></div> {/* Changed bg-white to bg-primary-foreground */}
              <span>{t('authPage.draganddropTestBuilding.text')}</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-primary-foreground rounded-full"></div> {/* Changed bg-white to bg-primary-foreground */}
              <span>{t('authPage.realtimeTestExecution.text')}</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-primary-foreground rounded-full"></div> {/* Changed bg-white to bg-primary-foreground */}
              <span>{t('authPage.comprehensiveReporting.text')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
