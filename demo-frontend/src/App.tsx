import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import HistoryPage from "@/pages/HistoryPage";
import LandingPage from "@/pages/LandingPage";
import UploadPage from "@/pages/UploadPage";
import DemoStartPage from "@/pages/DemoStartPage";
import { DEMO_ONLY } from "@/lib/demo";
import ProgressPage from "@/pages/ProgressPage";
import AnalysisPage from "@/pages/AnalysisPage";
import ReviewQueuePage from "@/pages/ReviewQueuePage";

function LegacyAnalysisRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/analyses/${id ?? ""}`} replace />;
}

// Public introduction (/), history (/history), comparison (/new), results (/analyses/:id).
export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    // A case opened from a scrolled landing starts at its heading; queue filters keep their position.
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return (
    <TooltipProvider delayDuration={200}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/new" element={DEMO_ONLY ? <DemoStartPage /> : <UploadPage />} />
        <Route path="/runs/:runId" element={<ProgressPage />} />
        <Route path="/analyses/:id" element={<AnalysisPage />} />
        <Route path="/analyses/:id/review" element={<ReviewQueuePage />} />
        <Route path="/analysis/:id" element={<LegacyAnalysisRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TooltipProvider>
  );
}
