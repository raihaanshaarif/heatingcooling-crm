"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { QuoteStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { acceptQuoteByToken, declineQuoteByToken } from "@/server/quotes/actions";

export function QuoteDecision({
  token,
  status,
  expired,
  options,
  selectedOptionId,
  businessPhone,
}: {
  token: string;
  status: QuoteStatus;
  expired: boolean;
  options: { id: string; name: string; totalCents: number }[];
  selectedOptionId: string | null;
  businessPhone: string | null;
}) {
  const router = useRouter();
  const [optionId, setOptionId] = useState(options.length === 1 ? options[0].id : "");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "ACCEPTED") {
    const chosen = options.find((o) => o.id === selectedOptionId);
    return (
      <Card className="border-emerald-500">
        <CardContent className="flex items-start gap-3">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold">Quote accepted. Thank you!</p>
            <p className="text-muted-foreground text-sm">
              {chosen ? `You chose ${chosen.name} (${formatCents(chosen.totalCents)}). ` : ""}
              We&apos;ll be in touch shortly to book in a time.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (status === "DECLINED") {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <XCircle className="text-muted-foreground size-6 shrink-0" />
          <p className="text-sm">
            You declined this quote. If you change your mind
            {businessPhone ? `, call us on ${businessPhone}` : ", get in touch"}.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (expired) {
    return (
      <Card>
        <CardContent className="text-sm">
          This quote has expired. Please contact us{businessPhone ? ` on ${businessPhone}` : ""} for
          an updated price.
        </CardContent>
      </Card>
    );
  }

  const accept = () =>
    startTransition(async () => {
      setError(null);
      const result = await acceptQuoteByToken({ token, optionId, signedName: name });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  const decline = () =>
    startTransition(async () => {
      setError(null);
      const result = await declineQuoteByToken({ token, reason });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-semibold">
          {options.length > 1 ? "Choose an option and accept" : "Accept this quote"}
        </h2>
        {options.length > 1 && (
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Options">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={optionId === o.id}
                onClick={() => setOptionId(o.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  optionId === o.id
                    ? "border-primary bg-primary/5 ring-primary ring-1"
                    : "hover:bg-muted",
                )}
              >
                <p className="font-medium">{o.name}</p>
                <p className="text-sm tabular-nums">{formatCents(o.totalCents)}</p>
              </button>
            ))}
          </div>
        )}
        {!declining ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="signedName">Your full name</Label>
              <Input
                id="signedName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <p className="text-muted-foreground text-xs">
                By accepting you agree to the quote and its terms and conditions.
              </p>
            </div>
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={accept} disabled={pending || !optionId || !name.trim()}>
                {pending && <Loader2 className="animate-spin" />} Accept quote
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => setDeclining(true)}
                disabled={pending}
              >
                Decline
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Anything we should know? (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" onClick={decline} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Decline quote
              </Button>
              <Button variant="ghost" onClick={() => setDeclining(false)} disabled={pending}>
                Back
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
