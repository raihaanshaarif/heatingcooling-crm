"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/components/forms/use-action";
import { deleteAttachment, uploadJobFiles } from "@/server/jobs/actions";
import { cn } from "@/lib/utils";

export interface AttachmentRow {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  kind: string;
  caption: string | null;
  uploadedById: string | null;
}

const KINDS = [
  { value: "BEFORE", label: "Before" },
  { value: "AFTER", label: "After" },
  { value: "PHOTO", label: "Photo" },
  { value: "DOCUMENT", label: "Document" },
];

/** Before / after photos and documents, with camera capture on phones. */
export function JobAttachments({
  jobId,
  attachments,
  currentUserId,
  canDeleteAny,
  large,
}: {
  jobId: string;
  attachments: AttachmentRow[];
  currentUserId: string;
  canDeleteAny: boolean;
  large?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("BEFORE");
  const [uploading, startUpload] = useTransition();
  const remove = useAction(deleteAttachment, {
    successMessage: "File deleted",
    onSuccess: () => router.refresh(),
  });
  const files = attachments.filter((a) => a.kind !== "SIGNATURE");

  const upload = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const data = new FormData();
    data.set("jobId", jobId);
    data.set("kind", kind);
    for (const f of Array.from(list)) data.append("files", f);
    startUpload(async () => {
      const result = await uploadJobFiles(data);
      if (result.ok) {
        toast.success(`${result.data.count} file${result.data.count > 1 ? "s" : ""} uploaded`);
        router.refresh();
      } else toast.error(result.error);
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className={cn("w-32", large && "h-11")} aria-label="Photo type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size={large ? "lg" : "sm"}
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Camera />} Add photos
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          capture={kind === "DOCUMENT" ? undefined : "environment"}
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((a) => (
            <figure key={a.id} className="group relative overflow-hidden rounded-md border">
              <a href={a.url} target="_blank" rel="noreferrer" className="block">
                {a.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user uploads served from storage
                  <img
                    src={a.url}
                    alt={a.caption ?? a.fileName}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="bg-muted flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center text-xs">
                    <FileText className="size-8" />
                    <span className="line-clamp-2 break-all">{a.fileName}</span>
                  </div>
                )}
              </a>
              <figcaption className="bg-background/90 absolute inset-x-0 bottom-0 px-2 py-1 text-xs">
                {KINDS.find((k) => k.value === a.kind)?.label ?? a.kind}
                {a.caption && ` · ${a.caption}`}
              </figcaption>
              {(canDeleteAny || a.uploadedById === currentUserId) && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute top-1 right-1 size-7 opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={() => void remove.run({ id: a.id })}
                  aria-label="Delete file"
                >
                  <Trash2 />
                </Button>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
