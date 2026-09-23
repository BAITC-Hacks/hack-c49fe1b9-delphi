"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import type { ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n";

export interface ConfirmNiceDialogProps {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export const ConfirmNiceDialog = NiceModal.create(({ title, description, confirmLabel, cancelLabel, destructive = false }: ConfirmNiceDialogProps) => {
  const modal = useModal();
  const { t } = useI18n();
  function close(answer: boolean) {
    modal.resolve(answer);
    void modal.hide();
    modal.remove();
  }
  return <AlertDialog open={modal.visible} onOpenChange={(open) => { if (!open) close(false); }}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle>{description && <AlertDialogDescription>{description}</AlertDialogDescription>}</AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => close(false)}>{cancelLabel ?? t("Отмена", "Бас тарту", "Cancel")}</AlertDialogCancel>
        <AlertDialogAction className={buttonVariants({ variant: destructive ? "destructive" : "default" })} onClick={() => close(true)}>{confirmLabel ?? t("Подтвердить", "Растау", "Confirm")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
});

export function confirm(props: ConfirmNiceDialogProps): Promise<boolean> {
  return NiceModal.show(ConfirmNiceDialog, props) as Promise<boolean>;
}
