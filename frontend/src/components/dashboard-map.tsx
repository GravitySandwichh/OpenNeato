import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import rotateLeftSvg from "../assets/icons/rotate-left.svg?raw";
import rotateRightSvg from "../assets/icons/rotate-right.svg?raw";
import { usePolling } from "../hooks/use-polling";
import type { HistoryFileInfo, MapData } from "../types";
import { computeMapProjection, drawMapGrid, isDarkSurface } from "../views/history/helpers";
import { Icon } from "./icon";

function loadRotation(): number {
    const raw = Number(localStorage.getItem("mapRotation"));
    if (!Number.isFinite(raw)) return 0;
    return (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
}

interface DashboardMapProps {
    isCleaning: boolean;
    robotReady: boolean;
}

export function DashboardMap({ isCleaning, robotReady }: DashboardMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [rotation, setRotation] = useState<number>(loadRotation);

    useEffect(() => {
        localStorage.setItem("mapRotation", String(rotation));
    }, [rotation]);

    const rotateBy = useCallback((delta: number) => {
        setRotation((r) => (((r + delta) % 360) + 360) % 360);
    }, []);

    // Poll history list frequently if cleaning, otherwise occasionally
    const pollInterval = !robotReady ? 0 : isCleaning ? 5000 : 30000;
    const historyList = usePolling<HistoryFileInfo[]>(api.getHistoryList, pollInterval);

    const [baseMap, setBaseMap] = useState<MapData | null>(null);
    const [liveMap, setLiveMap] = useState<MapData | null>(null);
    const [baseFilename, setBaseFilename] = useState<string | null>(null);

    // Filter sessions
    const sessions = historyList.data || [];
    const completedSessions = sessions.filter((s) => !s.recording);
    const activeSession = sessions.find((s) => s.recording);

    // Load base map once or when the latest completed session changes
    useEffect(() => {
        if (completedSessions.length > 0) {
            const latest = completedSessions[completedSessions.length - 1];
            if (latest.name !== baseFilename) {
                api.getHistorySession(latest.name)
                    .then((data) => {
                        if (data && data.length > 0) {
                            setBaseMap(data[data.length - 1]);
                            setBaseFilename(latest.name);
                        }
                    })
                    .catch(console.error);
            }
        }
    }, [completedSessions, baseFilename]);

    // Load active session continuously while cleaning
    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout>;

        const fetchLive = async () => {
            if (!activeSession) return;
            try {
                const data = await api.getHistorySession(activeSession.name);
                if (active && data && data.length > 0) {
                    setLiveMap(data[data.length - 1]);
                }
            } catch (e) {
                console.error("Failed to fetch live session", e);
            }
            if (active && isCleaning) {
                timer = setTimeout(fetchLive, 3000);
            }
        };

        if (isCleaning && activeSession) {
            fetchLive();
        } else if (!isCleaning) {
            setLiveMap(null);
        }

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [isCleaning, activeSession]);

    const [, setWindowSize] = useState([window.innerWidth, window.innerHeight]);
    useEffect(() => {
        const handleResize = () => setWindowSize([window.innerWidth, window.innerHeight]);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Render map
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // If neither map is available, do nothing (or clear)
        if (!baseMap && !liveMap) {
            const displayW = canvas.clientWidth;
            const displayH = canvas.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayW * dpr;
            canvas.height = displayH * dpr;
            ctx.scale(dpr, dpr);
            ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--surface").trim() || "#1a1a1c";
            ctx.fillRect(0, 0, displayW, displayH);
            return;
        }

        // Auto-align baseMap to liveMap to fix 90-degree rotation sync issues
        let alignedBaseMap = baseMap;
        if (baseMap && liveMap && liveMap.coverage.length > 5) {
            const baseSet = new Set(baseMap.coverage.map((c) => `${c[0]},${c[1]}`));
            let bestScore = -1;
            let bestRot = 0;

            for (const rot of [0, 90, 180, 270]) {
                let score = 0;
                for (const [cx, cy] of liveMap.coverage) {
                    let rx = cx,
                        ry = cy;
                    if (rot === 90) {
                        rx = cy;
                        ry = -cx;
                    } else if (rot === 180) {
                        rx = -cx;
                        ry = -cy;
                    } else if (rot === 270) {
                        rx = -cy;
                        ry = cx;
                    }
                    if (baseSet.has(`${rx},${ry}`)) score++;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestRot = rot;
                }
            }

            if (bestRot !== 0 && bestScore > 0) {
                alignedBaseMap = {
                    ...baseMap,
                    coverage: baseMap.coverage.map((cell) => {
                        const [cx, cy, ts] = cell;
                        if (bestRot === 90) return [-cy, cx, ts] as any;
                        if (bestRot === 180) return [-cx, -cy, ts] as any;
                        if (bestRot === 270) return [cy, -cx, ts] as any;
                        return cell;
                    }),
                };
                const { minX, maxX, minY, maxY } = baseMap.bounds!;
                if (bestRot === 90) {
                    alignedBaseMap.bounds = { minX: -maxY, maxX: -minY, minY: minX, maxY: maxX };
                } else if (bestRot === 180) {
                    alignedBaseMap.bounds = { minX: -maxX, maxX: -minX, minY: -maxY, maxY: -minY };
                } else if (bestRot === 270) {
                    alignedBaseMap.bounds = { minX: minY, maxX: maxY, minY: -maxX, maxY: -minX };
                }
            }
        }

        // Combine bounds
        let bounds = alignedBaseMap?.bounds;
        if (liveMap?.bounds) {
            if (!bounds) bounds = liveMap.bounds;
            else {
                bounds = {
                    minX: Math.min(bounds.minX, liveMap.bounds.minX),
                    maxX: Math.max(bounds.maxX, liveMap.bounds.maxX),
                    minY: Math.min(bounds.minY, liveMap.bounds.minY),
                    maxY: Math.max(bounds.maxY, liveMap.bounds.maxY),
                };
            }
        }
        if (!bounds) return;

        const displayW = canvas.clientWidth;
        const displayH = canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--surface").trim() || "#1a1a1c";
        ctx.fillRect(0, 0, displayW, displayH);

        if (rotation) {
            ctx.translate(displayW / 2, displayH / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.translate(-displayW / 2, -displayH / 2);
        }

        let projW = displayW;
        let projH = displayH;
        if (rotation === 90 || rotation === 270) {
            projW = displayH;
            projH = displayW;
        }

        const proj = computeMapProjection(projW, projH, bounds);
        const { scale, toX, toY } = proj;
        const isDark = isDarkSurface(canvas);

        drawMapGrid(ctx, proj, isDark);

        // Draw base map coverage (dim)
        if (alignedBaseMap) {
            const cellPx = alignedBaseMap.cellSize * scale;
            ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
            for (const cell of alignedBaseMap.coverage) {
                const [cx, cy] = cell;
                const wx = cx * alignedBaseMap.cellSize;
                const wy = cy * alignedBaseMap.cellSize;
                ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
            }
        }

        // Draw live map coverage (brighter)
        if (liveMap) {
            const cellPx = liveMap.cellSize * scale;
            ctx.fillStyle = isDark ? "rgba(52, 199, 89, 0.15)" : "rgba(22, 130, 50, 0.22)";
            for (const cell of liveMap.coverage) {
                const [cx, cy] = cell;
                const wx = cx * liveMap.cellSize;
                const wy = cy * liveMap.cellSize;
                ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
            }

            // Draw live path
            if (liveMap.path.length > 1) {
                ctx.beginPath();
                ctx.moveTo(toX(liveMap.path[0].x), toY(liveMap.path[0].y));
                for (let i = 1; i < liveMap.path.length; i++) {
                    ctx.lineTo(toX(liveMap.path[i].x), toY(liveMap.path[i].y));
                }
                ctx.strokeStyle = isDark ? "rgba(249, 235, 178, 0.8)" : "rgba(180, 140, 40, 0.8)";
                ctx.lineWidth = 2;
                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                ctx.stroke();
            }

            // Draw robot
            if (liveMap.path.length > 0) {
                const end = liveMap.path[liveMap.path.length - 1];
                const ex = toX(end.x);
                const ey = toY(end.y);
                const radius = 6;
                const screenAngle = -(end.t * Math.PI) / 180;

                ctx.save();
                ctx.translate(ex, ey);
                ctx.rotate(screenAngle);

                // Heading wedge
                ctx.beginPath();
                ctx.moveTo(radius + 5, 0);
                ctx.lineTo(radius * 0.6, -radius * 0.7);
                ctx.lineTo(radius * 0.6, radius * 0.7);
                ctx.closePath();
                ctx.fillStyle = "rgba(52, 199, 89, 0.95)";
                ctx.fill();

                // Body
                ctx.shadowColor = "rgba(52, 199, 89, 0.6)";
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(52, 199, 89, 0.95)";
                ctx.fill();
                ctx.shadowBlur = 0;

                // Inner dot
                ctx.beginPath();
                ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
                ctx.fill();

                ctx.restore();
            }
        }
    });

    return (
        <div class="dashboard-map-container" style={{ width: "100%", height: "100%", position: "relative" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: "8px" }} />
            {!baseMap && !liveMap && (
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "var(--text-dim)",
                        pointerEvents: "none",
                    }}
                >
                    No map data available
                </div>
            )}
            {(baseMap || liveMap) && (
                <>
                    <button
                        type="button"
                        class="history-rotate-btn left"
                        onClick={() => rotateBy(-90)}
                        aria-label="Rotate map counter-clockwise"
                    >
                        <Icon svg={rotateLeftSvg} />
                    </button>
                    <button
                        type="button"
                        class="history-rotate-btn right"
                        onClick={() => rotateBy(90)}
                        aria-label="Rotate map clockwise"
                    >
                        <Icon svg={rotateRightSvg} />
                    </button>
                </>
            )}
        </div>
    );
}
