"use client";
// Live camera capture (getUserMedia) — no gallery upload path, which is the
// anti-buddy-punching requirement for attendance selfies.
import { useEffect, useRef, useState } from "react";

export default function CameraCapture({
  onCapture,
  onCancel,
  facing = "user",
  title = "Take photo",
}: {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
  facing?: "user" | "environment";
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("Camera unavailable. Allow camera access and try again."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(canvas.toDataURL("image/jpeg", 0.6));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="card w-full max-w-sm p-4">
        <h3 className="font-bold text-center mb-3">{title}</h3>
        {error ? (
          <p className="text-red-600 text-sm text-center py-8">{error}</p>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black aspect-[3/4] object-cover" />
        )}
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost flex-1" onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); onCancel(); }}>
            Cancel
          </button>
          <button className="btn-primary flex-1" onClick={snap} disabled={!!error}>
            📷 Capture
          </button>
        </div>
      </div>
    </div>
  );
}
