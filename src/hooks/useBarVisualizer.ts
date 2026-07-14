"use client";

import { useEffect } from "react";
import { isRenderingActive, onRenderingActiveChange } from "@/lib/renderGate";
import type { RGB } from "@/lib/useCoverColor";

/**
 * Drives the compact bottom bar's frequency-spectrum canvas visualizer.
 * Side-effect only — no React state, direct canvas manipulation via RAF.
 */
export function useBarVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  analyserRef: React.RefObject<AnalyserNode | null>,
  audioRef: React.RefObject<HTMLAudioElement | null>,
  coverColor: RGB | null,
  isExpanded: boolean,
  isPlaying: boolean,
) {
  useEffect(() => {
    if (isExpanded) return;

    // Match the played bars to the cover colour (same as the rest of the player)
    let ar = 45, ag = 212, ab = 191; // fallback teal
    if (coverColor) { ar = coverColor.r; ag = coverColor.g; ab = coverColor.b; }

    // Maintain a persistent buffer to avoid GC pressure, dynamically resizing
    // only if the analyser's frequencyBinCount changes (e.g. 128 bins for fftSize 256).
    let dataArray = new Uint8Array(128);

    let animationFrame: number;
    let backoffId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleNext = () => {
      if (!active) return;
      const audio = audioRef.current;
      if (!audio || audio.paused || !isRenderingActive()) {
        backoffId = setTimeout(() => {
          backoffId = null;
          if (active) animationFrame = requestAnimationFrame(renderFrame);
        }, 200);
      } else {
        animationFrame = requestAnimationFrame(renderFrame);
      }
    };

    const renderFrame = () => {
      const audio = audioRef.current;
      if (!analyserRef.current || !canvasRef.current || !audio || audio.paused || !isRenderingActive()) {
        scheduleNext();
        return;
      }

      const analyser = analyserRef.current;
      const bufferLength = analyser.frequencyBinCount;
      if (dataArray.length !== bufferLength) {
        dataArray = new Uint8Array(bufferLength);
      }

      analyser.getByteFrequencyData(dataArray);

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) { scheduleNext(); return; }

      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let x = 0;
      const dur = audio.duration || 0;
      const currentProgressIdx = dur ? (audio.currentTime / dur) * bufferLength : 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255;
        const barHeight = Math.max(2, v * HEIGHT);
        const y = (HEIGHT - barHeight) / 2;
        const w = Math.max(1, barWidth - 2);
        const r = Math.min(w / 2, barHeight / 2);

        if (i < currentProgressIdx) {
          ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${Math.max(0.45, v)})`;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${Math.max(0.12, v * 0.7)})`;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, w, barHeight, r);
        ctx.fill();
        x += barWidth;
      }

      scheduleNext();
    };

    const stopGate = onRenderingActiveChange(() => {
      if (isRenderingActive() && active && backoffId !== null) {
        clearTimeout(backoffId); backoffId = null;
        animationFrame = requestAnimationFrame(renderFrame);
      }
    });

    animationFrame = requestAnimationFrame(renderFrame);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      if (backoffId !== null) clearTimeout(backoffId);
      stopGate();
    };
  }, [isExpanded, coverColor, isPlaying, canvasRef, analyserRef, audioRef]);
}
