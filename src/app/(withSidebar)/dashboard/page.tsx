// src/app/dashboard/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Toaster, toast } from "sonner";
import { fetchJSON, HttpError } from "@/lib/httpError";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Chunk = { startMs?: number; endMs?: number; text: string };
type ContentJson = { version?: number; summary?: string; chunks?: Chunk[] };
type Transcript = {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  sourceTabTitle: string | null;
  durationMs: number | null;
  chunkCount: number;
  contentJson: ContentJson | string | null;
  createdAt: string; // ISO string
};

function msToMMSS(ms?: number | null) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function parseContentJson(content: Transcript["contentJson"]): ContentJson {
  if (!content) return { chunks: [] };
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return { chunks: [] };
    }
  }
  return content as ContentJson;
}

function combineText(content: ContentJson): string {
  const chunks = content?.chunks ?? [];
  // join with line breaks; if you prefer timestamps, add them here
  return chunks
    .map((c) => c.text?.trim())
    .filter(Boolean)
    .join("\n");
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Transcript[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Transcript | null>(null);
  const [isStale, setIsStale] = useState(false);

  const allowed = useMemo(() => {
    const role = session?.user?.role;
    return role === "USER" || role === "ADMIN";
  }, [session?.user?.role]);

  const fetchTranscripts = useCallback(async (showToastOnError = true) => {
    setLoading(true);
    try {
      // IMPORTANT: use your actual route path
      const data = await fetchJSON<{ data: Transcript[] }>(
        "/api/transcripts/get-transcripts"
      );
      setRows(data.data || []);
      setIsStale(false);
    } catch (e) {
      const err = e as HttpError;
      // Keep prior rows; just mark as stale so UI doesn’t go blank
      setIsStale(true);

      if (showToastOnError) {
        if (err.status === 404) {
          toast.error(
            "Transcripts endpoint not found (404). Check the API path or route file location."
          );
        } else if (err.status === 401) {
          toast.error("Your session expired. Please log in again.");
        } else if (err.status && err.status >= 500) {
          toast.error(
            "Server error while fetching transcripts. Please try again."
          );
        } else {
          toast.error(err.message || "Failed to fetch transcripts.");
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || !allowed) {
      router.push("/login");
      return;
    }

    fetchTranscripts(true);
    const iv = setInterval(() => fetchTranscripts(false), 45_000);
    return () => clearInterval(iv);
  }, [status, session?.user, allowed, fetchTranscripts, router]);

  const onRowClick = (t: Transcript) => {
    setActive(t);
    setOpen(true);
  };

  const combinedText = useMemo(() => {
    if (!active) return "";
    const cj = parseContentJson(active.contentJson);
    return combineText(cj);
  }, [active]);

  return (
    <div className="min-h-screen p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Your Transcripts</h1>
        <Button
          onClick={() => fetchTranscripts(true)}
          disabled={loading}
          className="bg-[#3b639a]"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No transcripts yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => onRowClick(t)}
                  >
                    <TableCell className="font-medium">
                      {t.title ?? "Untitled"}
                    </TableCell>
                    <TableCell>
                      {t.sourceTabTitle ? (
                        <span title={t.sourceUrl ?? ""}>
                          {t.sourceTabTitle}
                        </span>
                      ) : t.sourceUrl ? (
                        <span title={t.sourceUrl}>{t.sourceUrl}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{msToMMSS(t.durationMs)}</TableCell>
                    <TableCell>{t.chunkCount ?? 0}</TableCell>
                    <TableCell>
                      {new Date(t.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {active?.title ?? "Transcript"}
            </DialogTitle>
            {active?.sourceUrl && (
              <DialogDescription>
                <a
                  href={active.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  {active.sourceTabTitle || active.sourceUrl}
                </a>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <div>
                <span className="font-medium">Created:</span>{" "}
                {active ? new Date(active.createdAt).toLocaleString() : "—"}
              </div>
              <div>
                <span className="font-medium">Duration:</span>{" "}
                {msToMMSS(active?.durationMs)}
              </div>
              <div>
                <span className="font-medium">Chunks:</span>{" "}
                {active?.chunkCount ?? 0}
              </div>
            </div>

            {/* Combined transcript text */}
            <div className="border rounded-md p-3 h-80 overflow-auto bg-muted/30">
              <pre className="whitespace-pre-wrap text-sm">
                {combinedText || "No text found in chunks."}
              </pre>
            </div>

            {/* Optional summary if you keep it in contentJson */}
            {(() => {
              if (!active) return null;
              const cj = parseContentJson(active.contentJson);
              if (!cj?.summary) return null;
              return (
                <div className="text-sm">
                  <span className="font-medium">Summary:</span> {cj.summary}
                </div>
              );
            })()}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(combinedText || "");
              }}
            >
              Copy Text
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
