"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/forms/use-action";
import { addJobNote } from "@/server/jobs/actions";

export function JobNoteForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const action = useAction(addJobNote, {
    successMessage: "Note added",
    onSuccess: () => {
      setBody("");
      router.refresh();
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) void action.run({ id: jobId, body });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={2}
        aria-label="Note"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={action.pending || !body.trim()}>
          Add note
        </Button>
      </div>
    </form>
  );
}
