import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@/styles/base.css";
import LandingPage from "@/pages/LandingPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode><LandingPage /></StrictMode>,
);
