"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/format";

interface Point { date: string; score: number; critical: number; high: number; medium: number; low: number }

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="text-faint">{formatDate(p.date)}</div>
      <div className="mt-1 text-sm font-semibold text-ink">Score {p.score}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 text-muted">
        <span>Critical {p.critical}</span><span>High {p.high}</span>
        <span>Medium {p.medium}</span><span>Low {p.low}</span>
      </div>
    </div>
  );
}

export function ScoreTrend({ data }: { data: Point[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgb(30 41 59 / 0.6)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" })}
            tick={{ fill: "rgb(100 116 139)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: "rgb(100 116 139)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: "rgb(148 163 184 / 0.4)", strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="score"
            stroke="rgb(34 211 238)"
            strokeWidth={2}
            fill="url(#scoreFill)"
            dot={data.length < 3 ? { r: 4, fill: "rgb(34 211 238)", stroke: "rgb(11 16 27)", strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: "rgb(34 211 238)", stroke: "rgb(11 16 27)", strokeWidth: 2 }}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
