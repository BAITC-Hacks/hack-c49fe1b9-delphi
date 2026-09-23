import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import HistoryPage from "@/pages/HistoryPage";
import UploadPage from "@/pages/UploadPage";
import ProgressPage from "@/pages/ProgressPage";
import AnalysisPage from "@/pages/AnalysisPage";
import ReviewQueuePage from "@/pages/ReviewQueuePage";

function LegacyAnalysisRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/analyses/${id ?? ""}`} replace />;
}

// Routes follow docs/product.md §3: history (/), new comparison (/new), results (/analyses/:id).
export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <Routes>
        <Route path="/" element={<HistoryPage />} />
        <Route path="/new" element={<UploadPage />} />
        <Route path="/runs/:runId" element={<ProgressPage />} />
        <Route path="/analyses/:id" element={<AnalysisPage />} />
        <Route path="/analyses/:id/review" element={<ReviewQueuePage />} />
        <Route path="/analysis/:id" element={<LegacyAnalysisRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TooltipProvider>
  );
}
