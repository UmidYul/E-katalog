"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils/format";
import { authStore } from "@/store/auth.store";

type PriceAlertModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  currentPrice: number | null;
  onSuccess?: (payload: { targetPrice: number | null; contact: string | null }) => void;
};

const formatPriceWithSum = (value: number | null) =>
  value != null && Number.isFinite(value) && value > 0 ? `${formatPrice(Math.round(value))} сўм` : "—";

export function PriceAlertModal({
  open,
  onOpenChange,
  productId,
  currentPrice,
  onSuccess,
}: PriceAlertModalProps) {
  const isAuthenticated = authStore((s) => s.isAuthenticated);
  const [targetPriceInput, setTargetPriceInput] = useState("");
  const [contact, setContact] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

  const closeModal = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSuccess(false);
      setPending(false);
      setTargetPriceInput("");
      setContact("");
    }
  };

  const submit = async () => {
    const parsedTarget = Number(String(targetPriceInput).replace(/\s+/g, ""));
    const targetPrice = Number.isFinite(parsedTarget) && parsedTarget > 0 ? Math.round(parsedTarget) : null;
    const cleanContact = String(contact ?? "").trim() || null;

    if (!isAuthenticated && !cleanContact) return;

    setPending(true);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          currentPrice,
          targetPrice,
          contact: cleanContact,
        }),
      });

      if (!response.ok) throw new Error("price_alert_save_failed");
      setSuccess(true);
      onSuccess?.({ targetPrice, contact: cleanContact });
    } catch {
      setSuccess(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={closeModal} title="Нарх огоҳлантириши">
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ Биз нарх пасайганда сизга хабар берамиз
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-secondary/20 p-3 text-sm">
            Жорий нарх: <strong>{formatPriceWithSum(currentPrice)}</strong>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Қайси нархдан паст бўлса хабар бериш</label>
            <Input
              value={targetPriceInput}
              onChange={(event) => setTargetPriceInput(event.target.value)}
              placeholder="Масалан: 11 500 000"
            />
          </div>

          {!isAuthenticated ? (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Email ёки телефон</label>
              <Input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="email@example.com ёки +998..."
              />
            </div>
          ) : null}

          <Button onClick={submit} disabled={pending || (!isAuthenticated && !String(contact).trim())}>
            {pending ? "Сақланмоқда..." : "Огоҳлантиришни ёқиш"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
