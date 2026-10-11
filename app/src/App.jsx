import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import ScrollToTop from "./components/ScrollToTop";
import { PCProvider, Shell } from "@/components/pc/Shell";
import MissionControl from "@/pages/MissionControl";
import Landing from "@/pages/Landing";
import BillDetail from "@/pages/BillDetail";
import VerifyCallPage from "@/pages/VerifyCallPage";
import { Bills, Vendors, VendorProfile, Approvals, Audit } from "@/pages/Lists";
import { Analytics, Evals, SettingsPage } from "@/pages/Insights";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <div className="fixed inset-0 flex items-center justify-center bg-[#070A0F]"><div className="w-8 h-8 border-4 border-[#1E2A38] border-t-[#10B981] rounded-full animate-spin" /></div>;
  }
  if (authError) {
    if (authError.type === "user_not_registered") return <UserNotRegisteredError />;
    if (authError.type === "auth_required") { navigateToLogin(); return null; }
  }
  return (
    <PCProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={
          <Shell>
            <Routes>
              <Route path="/mission" element={<MissionControl />} />
              <Route path="/bills" element={<Bills />} />
              <Route path="/bill/:id" element={<BillDetail />} />
              <Route path="/bill/:id/call" element={<VerifyCallPage />} />
              <Route path="/vendors" element={<Vendors />} />
              <Route path="/vendors/:id" element={<VendorProfile />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/evals" element={<Evals />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Shell>
        } />
      </Routes>
    </PCProvider>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster theme="dark" position="bottom-right" richColors />
      </QueryClientProvider>
    </AuthProvider>
  );
}
