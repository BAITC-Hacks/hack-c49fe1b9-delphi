"use client";

import { useState, type PropsWithChildren } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import NiceModal from "@/store/nice-modal-context";
import { I18nProvider } from "@/shared/i18n";
import { ApiError } from "@/shared/api/errors";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";

export function Providers({ children }: PropsWithChildren) {
  const router = useRouter();
  function checkSession(error: unknown) {
    if (error instanceof ApiError && error.status === 401) router.replace("/sign-in");
  }
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({ onError: checkSession }),
    mutationCache: new MutationCache({ onError: checkSession }),
    defaultOptions: { queries: { staleTime: 10_000, retry: false, refetchOnWindowFocus: true }, mutations: { retry: false } },
  }));
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <NiceModal.Provider>
          <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" theme="light" />
          </TooltipProvider>
        </NiceModal.Provider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
