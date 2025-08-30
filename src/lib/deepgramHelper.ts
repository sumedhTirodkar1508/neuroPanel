import { createClient as createDeepgramClient } from "@deepgram/sdk";

const deepgram = createDeepgramClient(process.env.DEEPGRAM_API_KEY!);

/** Fallback: Deepgram prerecord transcription (Nova-3) from raw bytes */
export async function transcribeWithDeepgramBytes(
  audio: Buffer, // <- Buffer only (fixes TS typing)
  mimeType?: string
): Promise<string> {
  console.log("[deepgram] Starting prerecord transcription (nova-3)...");
  console.log("[deepgram] Payload bytes:", audio.length);
  console.log("[deepgram] Declared mimetype:", mimeType);

  // Hints for WebM/Opus (MediaRecorder)
  const isWebm = (mimeType || "").includes("webm");
  const isOgg = (mimeType || "").includes("ogg");

  const options: any = {
    model: "nova-3",
    smart_format: true,
    // Deepgram SDK accepts these hints in options:
    mimetype: mimeType, // helps container detection
    encoding: isWebm || isOgg ? "opus" : undefined, // helps codec detection
    // language: "en", // if you know it
  };

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audio,
    options
  );

  if (error) {
    console.error("[deepgram] Error from API:", error);
    throw error;
  }

  // Log a small summary of the response for debugging:
  const alt = result?.results?.channels?.[0]?.alternatives?.[0];
  console.log("[deepgram] Got response:", {
    request_id: result?.metadata?.request_id,
    duration: result?.metadata?.duration,
    transcript_len: alt?.transcript?.length ?? 0,
    confidence: alt?.confidence,
  });

  return alt?.transcript ?? "";
}
