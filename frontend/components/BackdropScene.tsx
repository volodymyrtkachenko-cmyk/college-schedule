"use client";

import React from "react";
import type { BackdropPreset, SurfaceMaterial } from "@/lib/visualStudio";

interface BackdropSceneProps {
  backdrop: BackdropPreset;
  surface: SurfaceMaterial;
  compact?: boolean;
}

/**
 * Pure decorative background renderer shared between the fullscreen `AppBackdrop`,
 * the Studio live stage, and miniature backdrop thumbnails so every preset keeps
 * crisp geometric fidelity without duplicated markup.
 */
export function BackdropScene({
  backdrop,
  surface,
  compact = false,
}: BackdropSceneProps) {
  if (backdrop === "none" && surface === "glass") {
    return <div className="app-backdrop-glass-sheen absolute inset-0" />;
  }

  switch (backdrop) {
    case "aurora":
      return (
        <div className="app-backdrop-aurora absolute inset-0">
          <div className="app-aurora-orb app-aurora-orb-1" />
          <div className="app-aurora-orb app-aurora-orb-2" />
          <div className="app-aurora-orb app-aurora-orb-3" />
        </div>
      );

    case "silk":
      return (
        <div className="app-backdrop-silk absolute inset-0">
          <div className="app-backdrop-silk-gradient absolute inset-0" />
          <svg
            className="app-backdrop-silk-waves absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <path
              d="M -80 260 C 260 120, 560 440, 1280 180 L 1280 540 C 740 680, 380 390, -80 620 Z"
              fill="currentColor"
              fillOpacity="0.11"
            />
            <path
              d="M -60 440 C 310 250, 720 620, 1260 360"
              stroke="currentColor"
              strokeWidth={compact ? "1.35" : "1.5"}
              strokeOpacity="0.34"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M -60 510 C 340 320, 740 690, 1260 430"
              stroke="currentColor"
              strokeWidth={compact ? "1.1" : "1.1"}
              strokeOpacity="0.22"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M -60 180 C 300 40, 710 380, 1260 110"
              stroke="currentColor"
              strokeWidth={compact ? "1.1" : "1.1"}
              strokeOpacity="0.18"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {!compact && <div className="app-backdrop-silk-grain absolute inset-0" />}
        </div>
      );

    case "topo":
      return (
        <div className="app-backdrop-topo absolute inset-0">
          <svg
            className="app-topo-lines absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            {/* Top-right elevation ridge */}
            <path
              d="M 650 -40 C 710 150, 890 210, 1080 280 C 1170 315, 1220 390, 1250 470"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeOpacity="0.2"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 740 -30 C 790 130, 930 175, 1090 230 C 1160 255, 1205 315, 1240 375"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeOpacity="0.26"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 840 -20 C 875 105, 985 135, 1110 175 C 1165 192, 1200 235, 1230 275"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeOpacity="0.34"
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              cx="1095"
              cy="92"
              rx="115"
              ry="74"
              transform="rotate(-14 1095 92)"
              fill="currentColor"
              fillOpacity="0.06"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeOpacity="0.4"
              vectorEffect="non-scaling-stroke"
            />
            {/* Bottom-left valley contour */}
            <path
              d="M -40 430 C 140 450, 260 540, 355 690 C 405 768, 460 835, 520 930"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeOpacity="0.18"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M -40 520 C 115 535, 220 605, 295 730 C 335 795, 375 860, 420 930"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeOpacity="0.24"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M -40 615 C 85 628, 175 680, 225 775 C 255 830, 285 880, 310 930"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeOpacity="0.32"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx="88"
              cy="805"
              r="95"
              fill="currentColor"
              fillOpacity="0.05"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeOpacity="0.36"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );

    case "constellation":
      return (
        <div className="app-backdrop-constellation absolute inset-0">
          <svg
            className="app-constellation-svg absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <circle
              cx="600"
              cy="450"
              r="340"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 11"
              strokeOpacity="0.2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <svg
            className="app-constellation-svg absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <g stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.28" vectorEffect="non-scaling-stroke">
              <path d="M 140 210 L 310 140 L 455 245 L 365 380 L 140 210" />
              <path d="M 310 140 L 530 95" strokeOpacity="0.18" />
              <path d="M 790 155 L 950 230 L 1065 135" />
              <path d="M 950 230 L 895 410 L 1075 510 L 1140 365 L 950 230" />
              <path d="M 165 650 L 320 740 L 495 660 L 635 765" />
            </g>
            {[
              [140, 210, 4],
              [310, 140, 5.5],
              [455, 245, 3.5],
              [365, 380, 4.5],
              [530, 95, 3],
              [790, 155, 4],
              [950, 230, 6],
              [1065, 135, 3.5],
              [895, 410, 4],
              [1075, 510, 4.5],
              [1140, 365, 3],
              [165, 650, 4],
              [320, 740, 5],
              [495, 660, 4],
              [635, 765, 3.5],
              [690, 310, 2.5],
              [220, 490, 2.5],
              [780, 680, 2.5],
            ].map(([cx, cy, r], i) => (
              <circle
                key={`${cx}-${cy}-${i}`}
                cx={cx}
                cy={cy}
                r={compact ? Math.max(3, r * 1.15) : r}
                fill="currentColor"
                fillOpacity={i % 3 === 1 ? "0.65" : "0.42"}
              />
            ))}
          </svg>
        </div>
      );

    case "prism":
      return (
        <div className="app-backdrop-prism absolute inset-0">
          <div className="app-prism-beams absolute inset-0" />
          <svg
            className="app-prism-facets absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <polygon
              points="740,-40 1240,-40 940,560 560,340"
              fill="currentColor"
              fillOpacity="0.065"
            />
            <polygon
              points="220,-40 520,-40 140,760 -60,520"
              fill="currentColor"
              fillOpacity="0.05"
            />
            <polygon
              points="460,940 980,380 1260,640 860,940"
              fill="currentColor"
              fillOpacity="0.07"
            />
            <path
              d="M 740 -40 L 560 340 L 940 560 L 1240 -40 M 220 -40 L 140 760 M 980 380 L 460 940"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeOpacity="0.22"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );

    case "blueprint":
      return (
        <div className="app-backdrop-blueprint absolute inset-0">
          <svg
            className="app-blueprint-arcs absolute inset-0 h-full w-full"
            viewBox="0 0 1200 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <circle
              cx="1120"
              cy="90"
              r="260"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeDasharray="6 8"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx="1120"
              cy="90"
              r="180"
              stroke="currentColor"
              strokeWidth="1.15"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx="80"
              cy="810"
              r="300"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeDasharray="4 10"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 40 160 H 190 L 235 115 H 410"
              stroke="currentColor"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx="414" cy="115" r="5" fill="currentColor" />
            <path
              d="M 860 790 H 980 L 1020 750 H 1160"
              stroke="currentColor"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx="856" cy="790" r="5" fill="currentColor" />
            <path
              d="M 60 470 Q 150 380, 240 470 T 420 470 T 600 470"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeOpacity="0.7"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );

    case "dots":
      return <div className="app-backdrop-dots absolute inset-0" />;

    default:
      return null;
  }
}
