import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  mapRecordedSequence,
  type MappedTestStep,
  type RecordedAction,
  type RecordingSequenceResponse,
} from "@shared/recording";

const POLL_INTERVAL_MS = 2000;

export interface UseRecordingSessionOptions {
  /** Called whenever the recorded steps change (live during recording, and on stop). */
  onStepsChange: (steps: MappedTestStep[]) => void;
  onError: (title: string, description: string) => void;
  onNotice: (title: string, description: string) => void;
}

export interface UseRecordingSession {
  isRecording: boolean;
  isStarting: boolean;
  isStopping: boolean;
  sessionId: string | null;
  /** Raw buffer, so the UI can show what was captured without re-deriving it. */
  recordedActions: RecordedAction[];
  start: (url: string) => void;
  stop: () => void;
}

/**
 * Owns the whole record → poll → stop lifecycle.
 *
 * Previously this lived inline in the Create Test page in three near-duplicate copies
 * (start handler, poll handler, stop handler), each with its own slightly different
 * mapping — which is how the field-name mismatch went unnoticed. Mapping now happens in
 * exactly one place: `mapRecordedSequence` from the shared module.
 */
export function useRecordingSession({
  onStepsChange,
  onError,
  onNotice,
}: UseRecordingSessionOptions): UseRecordingSession {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recordedActions, setRecordedActions] = useState<RecordedAction[]>([]);

  // Callbacks are read through a ref so the polling effect depends only on the session
  // identity. Listing the callbacks would tear down and restart the interval on every
  // parent render.
  const callbacksRef = useRef({ onStepsChange, onError, onNotice });
  callbacksRef.current = { onStepsChange, onError, onNotice };

  /** Serialized snapshot of the last buffer applied, used to skip no-op updates. */
  const lastAppliedRef = useRef<string>("");

  const applySequence = useCallback((sequence: RecordedAction[]) => {
    const fingerprint = JSON.stringify(sequence);
    if (fingerprint === lastAppliedRef.current) return;
    lastAppliedRef.current = fingerprint;
    setRecordedActions(sequence);
    callbacksRef.current.onStepsChange(mapRecordedSequence(sequence));
  }, []);

  const startMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/start-recording", { url });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to start recording session.");
      }
      return result as { sessionId: string };
    },
    onSuccess: (data) => {
      lastAppliedRef.current = "";
      setRecordedActions([]);
      setSessionId(data.sessionId);
      setIsRecording(true);
    },
    onError: (error: Error) => {
      setIsRecording(false);
      setSessionId(null);
      callbacksRef.current.onError("recording.start.failed", error.message);
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (activeSessionId: string) => {
      const res = await apiRequest("POST", "/api/stop-recording", {
        sessionId: activeSessionId,
      });
      const result = (await res.json()) as RecordingSequenceResponse;
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to stop recording session.");
      }
      return result;
    },
    onSuccess: (result) => {
      applySequence(result.sequence ?? []);
    },
    onError: (error: Error) => {
      callbacksRef.current.onError("recording.stop.failed", error.message);
    },
    onSettled: () => {
      setIsRecording(false);
      setSessionId(null);
    },
  });

  // Poll the buffer so the user sees actions land while they interact with the browser.
  useEffect(() => {
    if (!isRecording || !sessionId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/get-recorded-actions?sessionId=${encodeURIComponent(sessionId)}`,
        );
        const result = (await res.json()) as RecordingSequenceResponse;
        if (cancelled) return;

        if (result.sequence) applySequence(result.sequence);

        if (result.sessionEnded) {
          setIsRecording(false);
          setSessionId(null);
          callbacksRef.current.onNotice(
            "recording.sessionEnded",
            result.error ?? "",
          );
          return;
        }

        if (!result.success && !res.ok) {
          callbacksRef.current.onError(
            "recording.pollFailed",
            result.error ?? `HTTP ${res.status}`,
          );
        }
      } catch (error) {
        // A transient network blip must not wipe the steps captured so far, so the
        // buffer is simply left untouched until the next tick.
        if (!cancelled) {
          console.warn("Recording poll failed, will retry:", error);
        }
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isRecording, sessionId, applySequence]);

  const start = useCallback(
    (url: string) => {
      startMutation.mutate(url);
    },
    [startMutation],
  );

  const stop = useCallback(() => {
    if (!sessionId) {
      setIsRecording(false);
      return;
    }
    stopMutation.mutate(sessionId);
  }, [sessionId, stopMutation]);

  return {
    isRecording,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    sessionId,
    recordedActions,
    start,
    stop,
  };
}
