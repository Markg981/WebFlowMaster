import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, TestTube, CheckCircle2, ShieldCheck, Zap, BarChart3 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion, AnimatePresence } from "framer-motion";

export default function AuthPage() {
  const { t } = useTranslation();
  const { user, loginMutation, registerMutation } = useAuth();
  const [, navigate] = useLocation();
  
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({ username: "", password: "", confirmPassword: "" });

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { type: "spring", stiffness: 100 }
    }
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] right-[10%] w-[30%] h-[30%] bg-accent/5 rounded-full blur-[100px]" />
      </div>

      {/* Left side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 z-10">
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="w-full max-w-md"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-primary/10 rounded-2xl mb-6 border border-primary/20 shadow-inner">
              <TestTube className="h-10 w-10 text-primary animate-pulse" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground mb-2">
              WebFlow<span className="text-primary">Master</span>
            </h1>
            <p className="text-muted-foreground font-medium uppercase tracking-widest text-xs">
              {t('authPage.automatedWebTestingMadeSimple.text')}
            </p>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="border-border/50 bg-background/60 backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-primary via-accent to-primary" />
              <CardHeader className="space-y-1 pt-8">
                <CardTitle className="text-2xl font-bold">{t('authPage.welcome.title')}</CardTitle>
                <CardDescription>
                  {t('authPage.signInToYourAccountOrCreate.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="login" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-8 bg-muted/50 p-1">
                    <TabsTrigger value="login" className="data-[state=active]:shadow-sm">
                      {t('authPage.signIn.button')}
                    </TabsTrigger>
                    <TabsTrigger value="register" className="data-[state=active]:shadow-sm">
                      {t('authPage.register.button')}
                    </TabsTrigger>
                  </TabsList>
                  
                  <AnimatePresence mode="wait">
                    <TabsContent value="login">
                      <motion.form 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        onSubmit={handleLogin} 
                        className="space-y-5"
                      >
                        <div className="space-y-2">
                          <Label htmlFor="login-username" className="text-sm font-semibold">{t('authPage.username.label')}</Label>
                          <Input
                            id="login-username"
                            type="text"
                            className="bg-muted/30 focus-visible:ring-primary/50 transition-all"
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
                            className="bg-muted/30 focus-visible:ring-primary/50 transition-all"
                            placeholder={t('authPage.enterYourPassword.placeholder')}
                            value={loginData.password}
                            onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                            required
                          />
                        </div>
                        {loginMutation.error && (
                          <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              {loginMutation.error.message}
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button 
                          type="submit" 
                          className="w-full h-11 text-base font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all" 
                          disabled={loginMutation.isPending}
                        >
                          {loginMutation.isPending ? t('authPage.signingIn.button') : t('authPage.signIn.button')}
                        </Button>
                      </motion.form>
                    </TabsContent>
                    
                    <TabsContent value="register">
                      <motion.form 
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        onSubmit={handleRegister} 
                        className="space-y-4"
                      >
                        <div className="space-y-2">
                          <Label htmlFor="register-username">{t('authPage.username.label')}</Label>
                          <Input
                            id="register-username"
                            type="text"
                            className="bg-muted/30 focus-visible:ring-primary/50"
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
                            className="bg-muted/30 focus-visible:ring-primary/50"
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
                            className="bg-muted/30 focus-visible:ring-primary/50"
                            placeholder={t('authPage.confirmYourPassword.placeholder')}
                            value={registerData.confirmPassword}
                            onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                            required
                          />
                        </div>
                        {registerData.password !== registerData.confirmPassword && registerData.confirmPassword && (
                          <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              {t('authPage.passwordsDoNotMatch.description')}
                            </AlertDescription>
                          </Alert>
                        )}
                        {registerMutation.error && (
                          <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              {registerMutation.error.message}
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button 
                          type="submit" 
                          className="w-full h-11 text-base font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all" 
                          disabled={registerMutation.isPending || registerData.password !== registerData.confirmPassword}
                        >
                          {registerMutation.isPending ? t('authPage.creatingAccount.button') : t('authPage.createAccount.button')}
                        </Button>
                      </motion.form>
                    </TabsContent>
                  </AnimatePresence>
                </Tabs>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>

      {/* Right side - Hero section */}
      <div className="hidden lg:flex flex-1 relative bg-zinc-950 overflow-hidden">
        {/* Abstract animated background */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(67,56,202,0.2),transparent_70%)]" />
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150" />
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              rotate: [0, 90, 0],
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -top-[20%] -right-[20%] w-[80%] h-[80%] bg-primary/20 rounded-full blur-[120px]" 
          />
          <motion.div 
            animate={{ 
              scale: [1, 1.3, 1],
              rotate: [0, -90, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute -bottom-[20%] -left-[20%] w-[60%] h-[60%] bg-accent/20 rounded-full blur-[100px]" 
          />
        </div>

        <div className="relative z-10 w-full flex flex-col items-center justify-center p-12 text-zinc-100">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="max-w-lg"
          >
            <div className="flex items-center space-x-2 mb-8 justify-center lg:justify-start">
              <Zap className="h-6 w-6 text-accent" />
              <span className="text-sm font-bold tracking-widest uppercase text-accent/80">Premium Enterprise Edition</span>
            </div>
            
            <h2 className="text-5xl font-extrabold mb-6 leading-tight text-center lg:text-left">
              {t('authPage.automateYourWebTesting.title')}
            </h2>
            <p className="text-xl text-zinc-400 mb-12 text-center lg:text-left leading-relaxed">
              {t('authPage.createExecuteAndManageAutomated.description')}{' '}
              <span className="text-zinc-100 font-semibold">{t('authPage.noCodingRequired.text')}</span>
            </p>

            <div className="grid grid-cols-2 gap-8">
              {[
                { icon: ShieldCheck, title: t('authPage.visualElementDetection.text'), desc: "Precision engine" },
                { icon: Zap, title: t('authPage.draganddropTestBuilding.text'), desc: "Fast workflow" },
                { icon: CheckCircle2, title: t('authPage.realtimeTestExecution.text'), desc: "Instant results" },
                { icon: BarChart3, title: t('authPage.comprehensiveReporting.text'), desc: "Deep analytics" },
              ].map((feature, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + (idx * 0.1) }}
                  className="flex flex-col items-center lg:items-start group"
                >
                  <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:border-accent/50 group-hover:bg-accent/10 transition-all duration-300 shadow-xl">
                    <feature.icon className="h-6 w-6 text-accent" />
                  </div>
                  <h3 className="font-bold text-zinc-100 group-hover:text-accent transition-colors">{feature.title}</h3>
                  <p className="text-sm text-zinc-500">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
